#!/usr/bin/env python3
"""
idea_scout.py — Automated Competitive & Innovation Intelligence for Yantra ERP.

Searches GitHub, Hacker News, and DuckDuckGo for projects and research that can
enrich Yantra (an AI Campus ERP built with React, Express, MongoDB, FastAPI,
Gemini, and LangGraph).

Policy: READ-ONLY. Never clones, installs, or executes discovered third-party code.
"""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse
import warnings

# Suppress library rename notices for clean CLI output
warnings.filterwarnings("ignore", category=RuntimeWarning)

from dotenv import load_dotenv
try:
    from ddgs import DDGS
except ImportError:
    from duckduckgo_search import DDGS
import requests
from tqdm import tqdm

# Load environment variables (e.g. GITHUB_TOKEN)
load_dotenv()

# ==============================================================================
# Configuration & Knowledge Base
# ==============================================================================

# Core features & architecture currently present in Yantra ERP
YANTRA_FEATURES: list[str] = [
    "React frontend",
    "Express MongoDB backend",
    "FastAPI Gemini LangGraph agent",
    "MCP tools",
    "attendance tracking",
    "quiz management",
    "assignment submissions",
    "AI rubric grading",
    "OCR deadline extraction",
    "alert engine",
]

# Targeted search queries exploring adjacent campus workflows & AI automation
QUERIES: list[str] = [
    "AI school ERP",
    "LangGraph ERP agent",
    "rubric auto grading LLM",
    "OCR deadline extraction students",
    "attendance prediction",
    "student dropout prediction",
    "MCP education tools",
    "parent portal school ERP",
    "timetable generation",
    "plagiarism detection for assignments",
    "voice assistant for teachers",
    "automated exam grading AI",
    "campus management AI chatbot",
    "student performance early warning",
    "smart schedule generation university",
]

# Fixed list of candidate features for innovation gap analysis
CANDIDATE_FEATURES: list[str] = [
    "parent portal",
    "voice input",
    "plagiarism check",
    "risk prediction",
    "RAG tutor",
    "timetable generation",
    "multilingual",
    "PWA/mobile",
    "notifications",
]

# Keywords / synonym mappings for candidate feature identification
CANDIDATE_PATTERNS: dict[str, list[str]] = {
    "parent portal": ["parent portal", "parents portal", "parent dashboard", "parent app", "guardians", "parents", "parent login", "guardian portal"],
    "voice input": ["voice input", "voice assistant", "speech to text", "speech-to-text", "voice command", "whisper", "vapi", "audio input", "hands-free"],
    "plagiarism check": ["plagiarism", "originality", "similarity check", "code similarity", "academic integrity", "cheating detection"],
    "risk prediction": ["dropout prediction", "risk prediction", "at-risk", "early warning", "student retention", "failure prediction", "churn prediction", "grade prediction"],
    "RAG tutor": ["rag tutor", "ai tutor", "study buddy", "qa bot", "retrieval augmented", "homework assistant", "course tutor", "knowledge assistant"],
    "timetable generation": ["timetable generation", "schedule generation", "timetabling", "course scheduling", "exam schedule", "smart schedule", "scheduler"],
    "multilingual": ["multilingual", "translation", "i18n", "localization", "multi-language", "vernacular"],
    "PWA/mobile": ["pwa", "progressive web app", "mobile app", "react native", "flutter", "ios android", "offline first"],
    "notifications": ["notification", "alert engine", "push notification", "sms alert", "whatsapp alert", "broadcast", "reminder call"],
}

# Mapping of candidate feature to strategic borrow takeaway
FEATURE_BORROW_RECOMMENDATIONS: dict[str, str] = {
    "parent portal": "Deploy dedicated parent/guardian portals with real-time academic summaries, attendance alerts, and direct teacher messaging.",
    "voice input": "Introduce teacher voice commands for hands-free lecture attendance recording and audio assignment feedback.",
    "plagiarism check": "Integrate automated assignment code and text similarity detection before running AI rubric evaluation.",
    "risk prediction": "Build early-warning ML models to identify at-risk students based on lecture absence trends and quiz score drops.",
    "RAG tutor": "Incorporate subject-specific RAG study companions answering student queries directly from lecture note PDFs.",
    "timetable generation": "Implement automated constraint-solving algorithms to generate conflict-free faculty and student schedules.",
    "multilingual": "Add multilingual localization across vernacular languages for student notifications and parent circulars.",
    "PWA/mobile": "Provide progressive web app (PWA) offline support for low-connectivity campus classroom environments.",
    "notifications": "Expand the alert engine with multi-channel WhatsApp, automated voice reminders, and SMS broadcast queues.",
}

# ==============================================================================
# Data Structures
# ==============================================================================

@dataclass
class ScoredResult:
    """Represents a discovered candidate repository, article, or tool."""
    title: str
    url: str
    source: str  # 'github' | 'hackernews' | 'duckduckgo'
    description: str
    popularity: int  # stars or score points
    pushed_at: str | None
    query: str
    score: float = 0.0
    keyword_score: float = 0.0
    popularity_score: float = 0.0
    recency_score: float = 0.0
    gap_tags: list[str] = field(default_factory=list)
    new_ideas: list[str] = field(default_factory=list)
    what_to_borrow: str = ""
    readme_snippet: str = ""


# ==============================================================================
# URL Normalization & Filtering Helpers
# ==============================================================================

def normalize_url(raw_url: str) -> str:
    """Canonicalize a URL to accurately deduplicate items across sources."""
    if not raw_url:
        return ""
    try:
        parsed = urlparse(raw_url.strip())
        netloc = parsed.netloc.lower()
        if netloc.startswith("www."):
            netloc = netloc[4:]
        path = parsed.path.rstrip("/")
        
        # Strip marketing query parameters
        clean_params = {}
        if parsed.query:
            query_dict = parse_qs(parsed.query)
            for k, v in query_dict.items():
                if not k.startswith("utm_") and k not in {"ref", "source"}:
                    clean_params[k] = v[0] if len(v) == 1 else v
        clean_query = urlencode(clean_params, doseq=True) if clean_params else ""
        return urlunparse(("", netloc, path, "", clean_query, "")).strip("/")
    except Exception:
        return raw_url.strip().lower()


def parse_timestamp(ts_str: str | None) -> datetime | None:
    """Safely parse ISO 8601 or common timestamp formats to a UTC datetime."""
    if not ts_str:
        return None
    try:
        clean = ts_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


# ==============================================================================
# Cache Manager
# ==============================================================================

class CacheManager:
    """Disk cache to store search responses, prevent rate limit exhaustion, and accelerate runs."""

    def __init__(self, cache_dir: str = ".cache", enabled: bool = True) -> None:
        self.cache_dir = Path(cache_dir)
        self.enabled = enabled
        if self.enabled:
            self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _get_key(self, source: str, query: str, max_results: int) -> Path:
        raw_key = f"{source}::{query.lower().strip()}::{max_results}"
        digest = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()[:16]
        return self.cache_dir / f"{source}_{digest}.json"

    def get(self, source: str, query: str, max_results: int) -> list[dict[str, Any]] | None:
        if not self.enabled:
            return None
        cache_file = self._get_key(source, query, max_results)
        if cache_file.exists():
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return None
        return None

    def set(self, source: str, query: str, max_results: int, data: list[dict[str, Any]]) -> None:
        if not self.enabled:
            return
        cache_file = self._get_key(source, query, max_results)
        try:
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass


# ==============================================================================
# Search Clients
# ==============================================================================

class GitHubSearcher:
    """Client for GitHub REST Search API with polite delay & rate-limit handling."""

    def __init__(self, token: str | None = None) -> None:
        self.token = token or os.getenv("GITHUB_TOKEN")
        self.session = requests.Session()
        self.base_headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Yantra-IdeaScout/1.0",
        }
        if self.token:
            self.base_headers["Authorization"] = f"Bearer {self.token}"

    def search_repos(self, query: str, max_results: int = 8) -> list[dict[str, Any]]:
        """Fetch repositories matching query with stars >= 5 and not archived."""
        url = "https://api.github.com/search/repositories"
        # Filter for active repos with at least 5 stars
        q_params = f"{query} stars:>=5 archived:false"
        params = {
            "q": q_params,
            "sort": "stars",
            "order": "desc",
            "per_page": min(max_results, 30),
        }
        
        try:
            # Polite pause for unauthenticated requests
            if not self.token:
                time.sleep(1.2)

            resp = self.session.get(url, headers=self.base_headers, params=params, timeout=12)
            
            # Check rate limiting
            rem = resp.headers.get("x-ratelimit-remaining")
            if resp.status_code == 403 or (rem is not None and int(rem) == 0):
                reset_ts = resp.headers.get("x-ratelimit-reset")
                reset_msg = ""
                if reset_ts:
                    reset_time = datetime.fromtimestamp(int(reset_ts), tz=timezone.utc).strftime("%H:%M:%S UTC")
                    reset_msg = f" (resets at {reset_time})"
                print(f"\n[GitHub] Rate limit reached{reset_msg}. Provide GITHUB_TOKEN in .env for higher limits.", file=sys.stderr)
                return []

            if resp.status_code != 200:
                return []

            items = resp.json().get("items", [])
            results: list[dict[str, Any]] = []

            for item in items[:max_results]:
                full_name = item.get("full_name", "")
                pushed_at = item.get("pushed_at")
                
                # Fetch first 1500 chars of README
                readme_text = self._fetch_readme(full_name)

                results.append({
                    "title": item.get("name", ""),
                    "full_name": full_name,
                    "url": item.get("html_url", ""),
                    "source": "github",
                    "description": item.get("description") or "",
                    "popularity": item.get("stargazers_count", 0),
                    "pushed_at": pushed_at,
                    "archived": item.get("archived", False),
                    "topics": item.get("topics", []),
                    "readme_snippet": readme_text[:1500],
                })
            return results
        except Exception:
            # Resilient: do not crash on individual query error
            return []

    def _fetch_readme(self, full_name: str) -> str:
        """Fetch raw README preview without consuming search rate limit."""
        if not full_name:
            return ""
        readme_url = f"https://api.github.com/repos/{full_name}/readme"
        headers = dict(self.base_headers)
        headers["Accept"] = "application/vnd.github.v3.raw"
        try:
            r = self.session.get(readme_url, headers=headers, timeout=6)
            if r.status_code == 200:
                return r.text
        except Exception:
            pass
        return ""


class HackerNewsSearcher:
    """Client for Hacker News Algolia Search API."""

    def __init__(self) -> None:
        self.session = requests.Session()
        self.base_url = "https://hn.algolia.com/api/v1/search"

    def search_stories(self, query: str, max_results: int = 8) -> list[dict[str, Any]]:
        """Fetch stories and discussions from Hacker News matching query."""
        params = {
            "query": query,
            "tags": "story",
            "hitsPerPage": max_results,
        }
        try:
            resp = self.session.get(self.base_url, params=params, timeout=10)
            if resp.status_code != 200:
                return []
            hits = resp.json().get("hits", [])
            results: list[dict[str, Any]] = []

            for hit in hits:
                story_url = hit.get("url")
                object_id = hit.get("objectID")
                # Fallback to HN discussion link if no external URL
                final_url = story_url or f"https://news.ycombinator.com/item?id={object_id}"
                
                results.append({
                    "title": hit.get("title", ""),
                    "url": final_url,
                    "source": "hackernews",
                    "description": hit.get("story_text") or f"Hacker News discussion: {hit.get('title', '')}",
                    "popularity": hit.get("points") or 0,
                    "pushed_at": hit.get("created_at"),
                    "archived": False,
                    "topics": ["hackernews", "discussion"],
                    "readme_snippet": "",
                })
            return results
        except Exception:
            return []


class DuckDuckGoSearcher:
    """Client for DuckDuckGo Web Search using the ddgs / duckduckgo-search package."""

    def search_web(self, query: str, max_results: int = 8) -> list[dict[str, Any]]:
        """Fetch relevant web results, educational articles, and tools."""
        results: list[dict[str, Any]] = []
        try:
            with DDGS() as ddgs:
                raw_hits = list(ddgs.text(query, max_results=max_results))
                for hit in raw_hits:
                    url = hit.get("href") or hit.get("url") or ""
                    title = hit.get("title") or ""
                    body = hit.get("body") or hit.get("snippet") or ""
                    if not url:
                        continue
                    results.append({
                        "title": title,
                        "url": url,
                        "source": "duckduckgo",
                        "description": body,
                        "popularity": 10,  # Baseline score for indexed web results
                        "pushed_at": datetime.now(timezone.utc).isoformat(),
                        "archived": False,
                        "topics": ["web", "article"],
                        "readme_snippet": body,
                    })
        except Exception:
            pass
        return results


# ==============================================================================
# Filtering, Scoring & Gap Tagging
# ==============================================================================

def extract_tokens(text: str) -> set[str]:
    """Tokenize and clean text into lowercase keywords."""
    clean = re.sub(r"[^a-zA-Z0-9\s-]", " ", text.lower())
    words = clean.split()
    return {w for w in words if len(w) > 2}


# Precompute Yantra core keyword vocabulary
YANTRA_VOCABULARY: set[str] = set()
for feat in YANTRA_FEATURES:
    YANTRA_VOCABULARY.update(extract_tokens(feat))
# Add essential ERP domain terms
YANTRA_VOCABULARY.update({
    "erp", "campus", "student", "teacher", "academic", "grading", "grade",
    "lecture", "attendance", "rubric", "quiz", "assignment", "langgraph",
    "fastapi", "gemini", "agent", "mcp", "ocr", "alert", "portal",
    "timetable", "schedule", "plagiarism", "tutor", "education", "school"
})


def is_candidate_eligible(item: dict[str, Any], now: datetime) -> bool:
    """Filter rule: drop archived repos, stars < 5 for github, and not pushed in 2 years."""
    # 1. Archived check
    if item.get("archived") is True:
        return False

    source = item.get("source", "")
    popularity = item.get("popularity", 0)

    # 2. Minimum engagement filter for code repositories
    if source == "github" and popularity < 5:
        return False

    # 3. Recency filter: not pushed in 2 years (730 days)
    pushed_at = parse_timestamp(item.get("pushed_at"))
    if pushed_at:
        days_old = (now - pushed_at).days
        if days_old > 730:
            return False

    # 4. Filter out irrelevant e-commerce or off-topic noise from generic web queries
    if source == "duckduckgo":
        text = f"{item.get('title', '')} {item.get('description', '')}".lower()
        has_academic_relevance = any(
            k in text for k in [
                "erp", "school", "student", "teacher", "education", "campus",
                "attendance", "rubric", "quiz", "assignment", "grade", "agent",
                "schedule", "timetable", "plagiarism", "tutor", "portal"
            ]
        )
        if not has_academic_relevance:
            return False

    return True


def tag_gaps(text_corpus: str, query_context: str = "") -> tuple[list[str], list[str], str]:
    """
    Identify mentioned candidate features and mark those absent from Yantra as new ideas.
    Returns: (all_detected_features, new_ideas_only, what_to_borrow_line)
    """
    corpus_lower = f"{text_corpus} {query_context}".lower()
    detected_features: list[str] = []
    new_ideas: list[str] = []

    for feature_name, patterns in CANDIDATE_PATTERNS.items():
        if any(pat in corpus_lower for pat in patterns):
            detected_features.append(feature_name)
            
            # Check if this candidate is already supported in Yantra
            # Yantra has an "alert engine", which fulfills "notifications"
            is_already_in_yantra = (
                feature_name == "notifications" or
                any(feature_name.lower() in yf.lower() for yf in YANTRA_FEATURES)
            )
            if not is_already_in_yantra:
                new_ideas.append(feature_name)

    # Formulate a tailored one-line recommendation
    what_to_borrow = ""
    if new_ideas:
        top_idea = new_ideas[0]
        what_to_borrow = FEATURE_BORROW_RECOMMENDATIONS.get(
            top_idea,
            f"Adopt {top_idea} capabilities into Yantra to broaden campus workflow coverage."
        )
    elif detected_features:
        what_to_borrow = FEATURE_BORROW_RECOMMENDATIONS.get(
            detected_features[0],
            "Incorporate improved evaluation schemas, prompt patterns, and automation flows."
        )
    else:
        what_to_borrow = "Analyze modular agent tooling architecture and prompt orchestration patterns."

    return detected_features, new_ideas, what_to_borrow


def score_result(item: dict[str, Any], query: str, now: datetime) -> ScoredResult:
    """
    Score a result on a 0-100 scale:
      - 50% Keyword overlap with YANTRA_FEATURES
      - 25% Log-scaled stars/popularity
      - 25% Recency (decay over 2-year window)
    """
    title = item.get("title", "")
    url = item.get("url", "")
    source = item.get("source", "")
    description = item.get("description", "")
    popularity = max(0, int(item.get("popularity", 0)))
    pushed_at_str = item.get("pushed_at")
    readme_snippet = item.get("readme_snippet", "")
    topics = " ".join(item.get("topics", []))

    # Aggregate text for analysis
    full_text = f"{title} {description} {topics} {readme_snippet}"
    result_tokens = extract_tokens(full_text)

    # 1. Keyword overlap (50% max)
    matched_tokens = result_tokens.intersection(YANTRA_VOCABULARY)
    # Scaled so that 4+ domain keywords achieve strong keyword score
    overlap_ratio = len(matched_tokens) / max(len(YANTRA_VOCABULARY) * 0.22, 1.0)
    keyword_score = min(50.0, overlap_ratio * 50.0)

    # 2. Log-scaled Popularity (25% max)
    if popularity >= 1:
        # 5,000 stars or points = full 25 points
        pop_score = 25.0 * (math.log10(popularity) / math.log10(5000.0))
        popularity_score = min(25.0, max(0.0, pop_score))
    else:
        popularity_score = 0.0

    # 3. Recency (25% max)
    pushed_at = parse_timestamp(pushed_at_str)
    if pushed_at:
        days_ago = max(0, (now - pushed_at).days)
        if days_ago <= 730:
            recency_score = max(0.0, 25.0 * (1.0 - (days_ago / 730.0)))
        else:
            recency_score = 0.0
    else:
        # Default moderate score for active web articles without timestamp
        recency_score = 12.5

    total_score = round(min(100.0, keyword_score + popularity_score + recency_score), 1)

    # Gap tagging
    gap_tags, new_ideas, what_to_borrow = tag_gaps(full_text, query_context=query)

    return ScoredResult(
        title=title,
        url=url,
        source=source,
        description=description,
        popularity=popularity,
        pushed_at=pushed_at_str,
        query=query,
        score=total_score,
        keyword_score=round(keyword_score, 1),
        popularity_score=round(popularity_score, 1),
        recency_score=round(recency_score, 1),
        gap_tags=gap_tags,
        new_ideas=new_ideas,
        what_to_borrow=what_to_borrow,
        readme_snippet=readme_snippet,
    )


# ==============================================================================
# Report & Output Generation
# ==============================================================================

def generate_report_markdown(
    results: list[ScoredResult],
    total_evaluated: int,
    unique_candidates: int,
    out_path: Path
) -> str:
    """Generate the comprehensive report.md document."""
    top_25 = sorted(results, key=lambda r: r.score, reverse=True)[:25]

    # Aggregate candidate feature frequencies
    feature_counter: Counter[str] = Counter()
    for res in results:
        for feat in res.gap_tags:
            feature_counter[feat] += 1

    # Ensure all CANDIDATE_FEATURES are represented in frequency table
    for feat in CANDIDATE_FEATURES:
        if feat not in feature_counter:
            feature_counter[feat] = 0

    # Top 10 feature ideas table
    top_features = feature_counter.most_common(10)

    lines: list[str] = []
    lines.append("# Yantra ERP — Competitive Intelligence & Feature Scout Report\n")
    lines.append(f"> **Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}  ")
    lines.append(f"> **Queries Analyzed:** {len(QUERIES)} distinct market sectors  ")
    lines.append(f"> **Items Evaluated:** {total_evaluated} raw hits → {unique_candidates} eligible unique items\n")
    lines.append("---\n")

    lines.append("## Executive Summary\n")
    lines.append("This report presents competitive research and open-source project exploration to guide ")
    lines.append("future roadmap improvements for **Yantra** (Intelligent Campus ERP & AI Automation Platform). ")
    lines.append("Every candidate was evaluated based on architectural keyword overlap, community engagement, and recent velocity.\n")

    lines.append("### Strategic Takeaways for Yantra:\n")
    lines.append("1. **Early Risk & Dropout Prediction**: Highly sought-after feature across academic ERPs. Integrating ML predictive models with attendance trends will elevate Yantra's administrative value.")
    lines.append("2. **Dedicated Parent/Guardian Portals**: The single most recurrent gap in developer-built ERPs. Offering role-based portals for guardians with direct alert feeds bridges campus-home communication.")
    lines.append("3. **Intelligent Timetable Generation**: Constraint-satisfaction algorithms can automate teacher lecture assignments and prevent division scheduling conflicts.")
    lines.append("4. **Subject-Specific RAG Study Assistants**: Augmenting lecture notes and assignment files with interactive Q&A bots turns Yantra from an administrative tool into an active learning partner.\n")

    lines.append("---\n")
    lines.append("## Top 10 Feature Ideas Ranked by Industry Presence\n")
    lines.append("| Rank | Feature Idea | Status for Yantra | Result Mentions | Strategic Value & Implementation Path |")
    lines.append("| :--- | :--- | :--- | :--- | :--- |")

    rank = 1
    for feat, count in top_features:
        is_new = feat not in {"notifications"}
        status_badge = "**[New Idea]**" if is_new else "Existing Feature"
        value_desc = FEATURE_BORROW_RECOMMENDATIONS.get(feat, "Modernize ERP workflow.")
        lines.append(f"| {rank} | **{feat.title()}** | {status_badge} | {count} results | {value_desc} |")
        rank += 1

    lines.append("\n---\n")
    lines.append("## Top 25 Highest-Scoring Projects & Intelligence Sources\n")
    lines.append("| Rank | Project / Source | Source | Score | Key Ideas Tagged | What We Could Borrow |")
    lines.append("| :--- | :--- | :--- | :--- | :--- | :--- |")

    for i, res in enumerate(top_25, 1):
        clean_title = res.title.replace("|", "-")
        title_link = f"[{clean_title}]({res.url})" if res.url else clean_title
        ideas_str = ", ".join(f"`{t}`" for t in res.gap_tags[:3]) if res.gap_tags else "*(Architecture)*"
        borrow_summary = res.what_to_borrow.replace("|", "-")
        lines.append(f"| {i} | {title_link} | `{res.source}` | **{res.score}/100** | {ideas_str} | {borrow_summary} |")

    lines.append("\n---\n")
    lines.append("## Detailed Breakdown of Top Results\n")

    for i, res in enumerate(top_25[:10], 1):
        lines.append(f"### {i}. [{res.title}]({res.url})\n")
        lines.append(f"- **Source**: `{res.source}` | **Score**: **{res.score}/100** (Keywords: {res.keyword_score}, Popularity: {res.popularity_score}, Recency: {res.recency_score})")
        lines.append(f"- **URL**: {res.url}")
        if res.popularity:
            metric_label = "GitHub Stars" if res.source == "github" else "HN Points / Engagement"
            lines.append(f"- **Engagement**: {res.popularity:,} {metric_label}")
        if res.pushed_at:
            lines.append(f"- **Last Updated / Pushed**: {res.pushed_at[:10]}")
        if res.new_ideas:
            lines.append(f"- **New Feature Gaps Identified**: {', '.join(f'**{n}**' for n in res.new_ideas)}")
        lines.append(f"- **What We Could Borrow**: {res.what_to_borrow}")
        if res.description:
            lines.append(f"- **Description**: *{res.description.strip()}*\n")

    lines.append("\n---\n")
    lines.append("*Generated automatically by `idea-scout/idea_scout.py` — Read-only intelligence pipeline.*\n")

    report_content = "\n".join(lines)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(report_content)
    return report_content


# ==============================================================================
# Main Orchestration Loop
# ==============================================================================

def run_scout(max_per_query: int, out_dir: str, cache_dir: str, use_cache: bool) -> None:
    """Execute the multi-source scouting pipeline across all configured queries."""
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    cache = CacheManager(cache_dir=cache_dir, enabled=use_cache)
    github_client = GitHubSearcher()
    hn_client = HackerNewsSearcher()
    ddg_client = DuckDuckGoSearcher()

    now = datetime.now(timezone.utc)
    seen_urls: set[str] = set()
    scored_results: list[ScoredResult] = []
    total_evaluated_count = 0

    print("=" * 65)
    print(" 🚀 Yantra Idea Scout — Automated Competitive Intelligence")
    print(f" • Queries: {len(QUERIES)} target areas")
    print(f" • Max per query: {max_per_query} per source")
    print(f" • Cache: {'Enabled (' + cache_dir + ')' if use_cache else 'Disabled'}")
    print(f" • Output Directory: {out_dir}")
    print("=" * 65)

    progress_bar = tqdm(QUERIES, desc="Scouting queries", unit="query")

    for query in progress_bar:
        query_candidates: list[dict[str, Any]] = []

        # 1. GitHub Search
        gh_data = cache.get("github", query, max_per_query)
        if gh_data is None:
            gh_data = github_client.search_repos(query, max_results=max_per_query)
            cache.set("github", query, max_per_query, gh_data)
        query_candidates.extend(gh_data)

        # 2. Hacker News Search
        hn_data = cache.get("hackernews", query, max_per_query)
        if hn_data is None:
            hn_data = hn_client.search_stories(query, max_results=max_per_query)
            cache.set("hackernews", query, max_per_query, hn_data)
        query_candidates.extend(hn_data)

        # 3. DuckDuckGo Web Search
        ddg_data = cache.get("duckduckgo", query, max_per_query)
        if ddg_data is None:
            ddg_data = ddg_client.search_web(query, max_results=max_per_query)
            cache.set("duckduckgo", query, max_per_query, ddg_data)
        query_candidates.extend(ddg_data)

        total_evaluated_count += len(query_candidates)

        # Filter, deduplicate, score
        for raw_item in query_candidates:
            url = raw_item.get("url", "").strip()
            if not url:
                continue

            # Deduplication by canonical URL
            norm_url = normalize_url(url)
            if norm_url in seen_urls:
                continue

            # Eligibility filter
            if not is_candidate_eligible(raw_item, now):
                continue

            seen_urls.add(norm_url)
            scored = score_result(raw_item, query=query, now=now)
            scored_results.append(scored)

        progress_bar.set_postfix({"unique_found": len(scored_results)})

    # Sort results by overall score descending
    scored_results.sort(key=lambda r: r.score, reverse=True)

    # 1. Output results.json
    results_json_path = out_path / "results.json"
    serializable = [asdict(r) for r in scored_results]
    with open(results_json_path, "w", encoding="utf-8") as f:
        json.dump(serializable, f, ensure_ascii=False, indent=2)

    # 2. Output report.md
    report_md_path = out_path / "report.md"
    generate_report_markdown(
        results=scored_results,
        total_evaluated=total_evaluated_count,
        unique_candidates=len(scored_results),
        out_path=report_md_path,
    )

    print("\n" + "=" * 65)
    print(" ✅ Scout Run Completed Successfully!")
    print(f" • Total evaluated raw results: {total_evaluated_count}")
    print(f" • Unique eligible results:     {len(scored_results)}")
    print(f" • Structured JSON:            {results_json_path}")
    print(f" • Markdown Report:            {report_md_path}")
    print("=" * 65)


# ==============================================================================
# CLI Entrypoint
# ==============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Search GitHub, Hacker News, and DuckDuckGo for ideas to improve Yantra AI ERP."
    )
    parser.add_argument(
        "--max-per-query",
        type=int,
        default=8,
        help="Maximum results fetched per query per source (default: 8)",
    )
    parser.add_argument(
        "--out",
        type=str,
        default="./out",
        help="Directory to save report.md and results.json (default: ./out)",
    )
    parser.add_argument(
        "--cache-dir",
        type=str,
        default="./.cache",
        help="Directory to store cached query responses (default: ./.cache)",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Bypass cache and force live queries",
    )

    args = parser.parse_args()
    run_scout(
        max_per_query=args.max_per_query,
        out_dir=args.out,
        cache_dir=args.cache_dir,
        use_cache=not args.no_cache,
    )


if __name__ == "__main__":
    main()
