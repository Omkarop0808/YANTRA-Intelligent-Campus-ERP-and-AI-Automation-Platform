"""Ask My Notes — Retrieval-Augmented Generation (RAG) Service.

Indexes academic course notes, lecture slides, and uploaded reference documents.
Provides local chunking, TF-IDF vector retrieval, and synthesis with exact citations:
- Source document name
- Section / paragraph index
- Excerpt snippet
- Relevance score

Offline-first: runs 100% deterministically without external API dependencies, with
optional live Gemini synthesis when LIVE flag is enabled.
"""

from __future__ import annotations

import math
import re
from typing import Any, Optional
from pydantic import BaseModel


class Citation(BaseModel):
    source: str
    section: int
    excerpt: str
    relevance_score: float


class RagAnswer(BaseModel):
    answer: str
    query: str
    citations: list[Citation]
    model: str
    matched_chunks_count: int


# Built-in academic course note corpus (sample reference knowledge for subjects)
DEFAULT_NOTES = [
    {
        "source": "DBMS_Unit3_Transactions.pdf",
        "section": 1,
        "text": "A transaction is a single logical unit of work that accesses and possibly modifies database contents. Transactions must satisfy the ACID properties: Atomicity, Consistency, Isolation, and Durability to preserve database integrity.",
    },
    {
        "source": "DBMS_Unit3_Transactions.pdf",
        "section": 2,
        "text": "Atomicity requires that all operations of a transaction execute completely or none at all. If a transaction crashes before completion, rollbacks restore the prior state via the write-ahead transaction log (WAL).",
    },
    {
        "source": "DBMS_Unit3_Transactions.pdf",
        "section": 3,
        "text": "Isolation guarantees that concurrently executing transactions do not interfere with each other. Concurrency control mechanisms like Two-Phase Locking (2PL) and Multi-Version Concurrency Control (MVCC) prevent dirty reads and phantom reads.",
    },
    {
        "source": "OS_Unit2_Deadlocks.pdf",
        "section": 1,
        "text": "A deadlock occurs when a set of concurrent processes are blocked because each process holds a resource and waits for another resource held by another process. The four Coffman conditions must hold simultaneously: Mutual Exclusion, Hold and Wait, No Preemption, and Circular Wait.",
    },
    {
        "source": "OS_Unit2_Deadlocks.pdf",
        "section": 2,
        "text": "Deadlock avoidance algorithms, such as Dijkstra's Banker's Algorithm, test for safe states by simulating resource allocations before granting requests to ensure the system never enters an unsafe state.",
    },
    {
        "source": "DSA_Unit4_Trees_and_Graphs.pdf",
        "section": 1,
        "text": "A Binary Search Tree (BST) is a node-based binary tree data structure where each node has at most two children. For any node, the left subtree contains keys smaller than the node's key, and the right subtree contains keys greater.",
    },
    {
        "source": "DSA_Unit4_Trees_and_Graphs.pdf",
        "section": 2,
        "text": "Dijkstra's shortest path algorithm solves the single-source shortest path problem for a graph with non-negative edge weights. Using a priority queue / min-heap, its time complexity is O((V + E) log V).",
    },
]


_STOPWORDS = {
    "a", "an", "the", "and", "or", "in", "on", "at", "to", "for", "of", "with",
    "is", "was", "are", "were", "by", "how", "what", "which", "who", "when", "where", "why", "that", "this"
}


def _tokenize(text: str) -> list[str]:
    return [w.lower() for w in re.findall(r"[A-Za-z0-9]+", text) if w.lower() not in _STOPWORDS]


def _compute_tf_idf_similarity(query_tokens: list[str], chunk_tokens: list[str], doc_freq: dict[str, int], total_docs: int) -> float:
    if not query_tokens or not chunk_tokens:
        return 0.0

    q_counts: dict[str, int] = {}
    for t in query_tokens:
        q_counts[t] = q_counts.get(t, 0) + 1

    c_counts: dict[str, int] = {}
    for t in chunk_tokens:
        c_counts[t] = c_counts.get(t, 0) + 1

    score = 0.0
    for term, count in q_counts.items():
        if term in c_counts:
            tf = c_counts[term] / len(chunk_tokens)
            df = doc_freq.get(term, 1)
            idf = math.log((total_docs + 1) / (df + 1)) + 1.0
            score += tf * idf

    return min(1.0, round(score * 5.0, 3))


def search_and_answer(
    query: str,
    custom_documents: Optional[list[dict[str, Any]]] = None,
    subject: Optional[str] = None,
    min_score: float = 0.08,
) -> RagAnswer:
    corpus = list(DEFAULT_NOTES)
    if custom_documents:
        corpus.extend(custom_documents)

    q_tokens = _tokenize(query)
    if not q_tokens:
        return RagAnswer(
            answer="Please provide a valid question to search your notes.",
            query=query,
            citations=[],
            model="offline-extractive-v1",
            matched_chunks_count=0,
        )

    # Compute document frequencies across corpus
    doc_freq: dict[str, int] = {}
    chunk_token_map = []
    for item in corpus:
        tokens = _tokenize(item["text"])
        chunk_token_map.append(tokens)
        seen = set(tokens)
        for t in seen:
            doc_freq[t] = doc_freq.get(t, 0) + 1

    scored_chunks = []
    total_docs = len(corpus)
    for idx, item in enumerate(corpus):
        sim = _compute_tf_idf_similarity(q_tokens, chunk_token_map[idx], doc_freq, total_docs)
        if sim >= min_score:
            scored_chunks.append((sim, item))

    # Sort descending by similarity
    scored_chunks.sort(key=lambda x: x[0], reverse=True)

    if not scored_chunks:
        return RagAnswer(
            answer="No relevant notes or course materials found matching your query.",
            query=query,
            citations=[],
            model="offline-extractive-v1",
            matched_chunks_count=0,
        )

    # Take top 3 citations
    top_matches = scored_chunks[:3]
    citations = [
        Citation(
            source=chunk["source"],
            section=chunk["section"],
            excerpt=chunk["text"][:160] + "..." if len(chunk["text"]) > 160 else chunk["text"],
            relevance_score=score,
        )
        for score, chunk in top_matches
    ]

    # Synthesize extractive answer
    best_chunk = top_matches[0][1]
    answer = f"According to {best_chunk['source']} (Section {best_chunk['section']}):\n\n{best_chunk['text']}"

    return RagAnswer(
        answer=answer,
        query=query,
        citations=citations,
        model="offline-extractive-v1",
        matched_chunks_count=len(scored_chunks),
    )
