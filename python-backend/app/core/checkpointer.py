"""Pluggable LangGraph checkpointer implementation.

Selectable via environment variable `CHECKPOINTER_BACKEND`:
- "memory" (default): In-memory MemorySaver
- "mongodb": MongoDB-backed checkpointer for horizontal multi-instance scaling

Rationale for MongoDB Checkpointer:
The installed LangGraph 1.x release does not include a native `langgraph-checkpoint-redis` package.
Because Yantra's unified data plane is already built on MongoDB (with replication and clustering support),
implementing a MongoDB-backed checkpointer avoids introducing unmanaged stateful Redis dependencies,
guarantees persistence across container restarts, and allows multiple FastAPI replicas to seamlessly
share and continue active conversation threads.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Sequence
from typing import Any, Mapping

from langgraph.checkpoint.base import (
    BaseCheckpointSaver,
    ChannelVersions,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
)
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.serde.base import SerializerProtocol
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.database import Database


class MongoDBSaver(BaseCheckpointSaver[str]):
    """Persistent, horizontally-scalable checkpointer backed by MongoDB."""

    def __init__(
        self,
        mongo_uri: str = "mongodb://127.0.0.1:27017/yantra_erp",
        db_name: str = "yantra_erp",
        *,
        serde: SerializerProtocol | None = None,
    ) -> None:
        super().__init__(serde=serde)
        self.client = MongoClient(mongo_uri)
        # Handle db in URI or explicit
        if "/" in mongo_uri.split("://")[-1]:
            uri_db = mongo_uri.split("/")[-1].split("?")[0]
            if uri_db:
                db_name = uri_db
        self.db: Database = self.client[db_name]
        self.checkpoints = self.db["agent_checkpoints"]
        self.writes = self.db["agent_checkpoint_writes"]

        # Ensure indexes for fast thread lookup
        self.checkpoints.create_index(
            [("thread_id", ASCENDING), ("checkpoint_ns", ASCENDING), ("checkpoint_id", DESCENDING)],
            unique=True,
        )
        self.writes.create_index(
            [("thread_id", ASCENDING), ("checkpoint_ns", ASCENDING), ("checkpoint_id", ASCENDING), ("task_id", ASCENDING), ("idx", ASCENDING)],
            unique=True,
        )

    def get_tuple(self, config: dict[str, Any]) -> CheckpointTuple | None:
        configurable = config.get("configurable", {})
        thread_id = configurable.get("thread_id")
        checkpoint_ns = configurable.get("checkpoint_ns", "")
        checkpoint_id = configurable.get("checkpoint_id")

        query: dict[str, Any] = {"thread_id": thread_id, "checkpoint_ns": checkpoint_ns}
        if checkpoint_id:
            query["checkpoint_id"] = checkpoint_id

        doc = self.checkpoints.find_one(query, sort=[("checkpoint_id", DESCENDING)])
        if not doc:
            return None

        # Deserialise checkpoint and metadata
        chk_type, chk_bytes = doc["checkpoint"]
        checkpoint = self.serde.loads_typed((chk_type, chk_bytes))

        meta_type, meta_bytes = doc["metadata"]
        metadata = self.serde.loads_typed((meta_type, meta_bytes))

        parent_config = None
        if doc.get("parent_checkpoint_id"):
            parent_config = {
                "configurable": {
                    "thread_id": thread_id,
                    "checkpoint_ns": checkpoint_ns,
                    "checkpoint_id": doc["parent_checkpoint_id"],
                }
            }

        # Load pending writes
        writes_cursor = self.writes.find({
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
            "checkpoint_id": doc["checkpoint_id"],
        }).sort("idx", ASCENDING)

        pending_writes = []
        for w in writes_cursor:
            val_type, val_bytes = w["value"]
            pending_writes.append((w["task_id"], w["channel"], self.serde.loads_typed((val_type, val_bytes))))

        return CheckpointTuple(
            config={
                "configurable": {
                    "thread_id": thread_id,
                    "checkpoint_ns": checkpoint_ns,
                    "checkpoint_id": doc["checkpoint_id"],
                }
            },
            checkpoint=checkpoint,
            metadata=metadata,
            parent_config=parent_config,
            pending_writes=pending_writes,
        )

    def list(
        self,
        config: dict[str, Any] | None,
        *,
        filter: dict[str, Any] | None = None,
        before: dict[str, Any] | None = None,
        limit: int | None = None,
    ) -> Iterator[CheckpointTuple]:
        query: dict[str, Any] = {}
        if config and "configurable" in config:
            configurable = config["configurable"]
            if "thread_id" in configurable:
                query["thread_id"] = configurable["thread_id"]
            if "checkpoint_ns" in configurable:
                query["checkpoint_ns"] = configurable["checkpoint_ns"]
        if before and "configurable" in before:
            query["checkpoint_id"] = {"$lt": before["configurable"]["checkpoint_id"]}

        cursor = self.checkpoints.find(query).sort("checkpoint_id", DESCENDING)
        if limit:
            cursor = cursor.limit(limit)

        for doc in cursor:
            chk_type, chk_bytes = doc["checkpoint"]
            checkpoint = self.serde.loads_typed((chk_type, chk_bytes))

            meta_type, meta_bytes = doc["metadata"]
            metadata = self.serde.loads_typed((meta_type, meta_bytes))

            parent_config = None
            if doc.get("parent_checkpoint_id"):
                parent_config = {
                    "configurable": {
                        "thread_id": doc["thread_id"],
                        "checkpoint_ns": doc["checkpoint_ns"],
                        "checkpoint_id": doc["parent_checkpoint_id"],
                    }
                }

            yield CheckpointTuple(
                config={
                    "configurable": {
                        "thread_id": doc["thread_id"],
                        "checkpoint_ns": doc["checkpoint_ns"],
                        "checkpoint_id": doc["checkpoint_id"],
                    }
                },
                checkpoint=checkpoint,
                metadata=metadata,
                parent_config=parent_config,
            )

    def put(
        self,
        config: dict[str, Any],
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> dict[str, Any]:
        configurable = config["configurable"]
        thread_id = configurable["thread_id"]
        checkpoint_ns = configurable.get("checkpoint_ns", "")
        checkpoint_id = checkpoint["id"]

        chk_typed = self.serde.dumps_typed(checkpoint)
        meta_typed = self.serde.dumps_typed(metadata)

        doc = {
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
            "checkpoint_id": checkpoint_id,
            "parent_checkpoint_id": configurable.get("checkpoint_id"),
            "checkpoint": list(chk_typed),
            "metadata": list(meta_typed),
        }

        self.checkpoints.replace_one(
            {"thread_id": thread_id, "checkpoint_ns": checkpoint_ns, "checkpoint_id": checkpoint_id},
            doc,
            upsert=True,
        )

        return {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_ns": checkpoint_ns,
                "checkpoint_id": checkpoint_id,
            }
        }

    def put_writes(
        self,
        config: dict[str, Any],
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        configurable = config["configurable"]
        thread_id = configurable["thread_id"]
        checkpoint_ns = configurable.get("checkpoint_ns", "")
        checkpoint_id = configurable["checkpoint_id"]

        for idx, (channel, val) in enumerate(writes):
            val_typed = self.serde.dumps_typed(val)
            doc = {
                "thread_id": thread_id,
                "checkpoint_ns": checkpoint_ns,
                "checkpoint_id": checkpoint_id,
                "task_id": task_id,
                "idx": idx,
                "channel": channel,
                "value": list(val_typed),
                "task_path": task_path,
            }
            self.writes.replace_one(
                {
                    "thread_id": thread_id,
                    "checkpoint_ns": checkpoint_ns,
                    "checkpoint_id": checkpoint_id,
                    "task_id": task_id,
                    "idx": idx,
                },
                doc,
                upsert=True,
            )

    def delete_thread(self, thread_id: str) -> None:
        self.checkpoints.delete_many({"thread_id": thread_id})
        self.writes.delete_many({"thread_id": thread_id})

    async def aget_tuple(self, config: dict[str, Any]) -> CheckpointTuple | None:
        return self.get_tuple(config)

    async def alist(
        self,
        config: dict[str, Any] | None,
        *,
        filter: dict[str, Any] | None = None,
        before: dict[str, Any] | None = None,
        limit: int | None = None,
    ) -> AsyncIterator[CheckpointTuple]:
        for item in self.list(config, filter=filter, before=before, limit=limit):
            yield item

    async def aput(
        self,
        config: dict[str, Any],
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> dict[str, Any]:
        return self.put(config, checkpoint, metadata, new_versions)

    async def aput_writes(
        self,
        config: dict[str, Any],
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        return self.put_writes(config, writes, task_id, task_path)

    async def adelete_thread(self, thread_id: str) -> None:
        return self.delete_thread(thread_id)


def get_checkpointer(backend: str | None = None) -> BaseCheckpointSaver[str]:
    """Factory selecting checkpointer based on CHECKPOINTER_BACKEND env."""
    choice = (backend or os.getenv("CHECKPOINTER_BACKEND", "memory")).lower().strip()
    if choice == "mongodb":
        mongo_uri = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017/yantra_erp")
        return MongoDBSaver(mongo_uri=mongo_uri)
    return MemorySaver()
