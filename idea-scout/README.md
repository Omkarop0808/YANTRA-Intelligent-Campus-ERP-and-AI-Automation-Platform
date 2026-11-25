# Idea Scout — Competitive & Feature Discovery for Yantra ERP

`idea_scout.py` is an automated, read-only research tool that scouts GitHub, Hacker News, and DuckDuckGo for innovative ideas, open-source projects, and research papers that can enhance **Yantra** (the AI Campus ERP platform).

> **Read-only Policy**: This script strictly searches and inspects metadata and README previews. It **never** clones, installs, or executes any found code.

---

## Features

- **Multi-Source Intelligence**:
  - **GitHub Search API**: Repositories, stars, topics, recency, and README analysis.
  - **Hacker News (Algolia)**: Real-world engineering discussions, launches, and blog posts.
  - **DuckDuckGo Web Search**: Relevant articles, open-source platforms, and academic implementations.
- **Smart Filtering**: Automatically drops archived repos, stale projects (>2 years without updates), low-engagement repos (<5 stars), and deduplicates by canonical URL.
- **Three-Factor Scoring (0–100)**:
  - 50% Keyword & Feature Overlap with Yantra's architecture
  - 25% Popularity & Community Traction (log-scaled stars / points)
  - 25% Recency & Maintenance Velocity
- **Gap Tagging**: Detects candidate features (`parent portal`, `voice input`, `plagiarism check`, `risk prediction`, `RAG tutor`, `timetable generation`, `multilingual`, `PWA/mobile`, `notifications`) and identifies whether they represent completely **new ideas** for Yantra.
- **Local Disk Cache**: Caches responses in `.cache/` to minimize API queries and gracefully handle rate limits.

---

## Quickstart

### 1. Install Dependencies

```bash
cd idea-scout
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure Environment (Optional)

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
*(Optional)* Add your `GITHUB_TOKEN` to `.env` to raise GitHub search API rate limits. The script also runs fully unauthenticated with automatic polite throttling.

### 3. Run the Scout

Run a quick test run:
```bash
python idea_scout.py --max-per-query 3 --out ./out
```

Run a full comprehensive scout:
```bash
python idea_scout.py --max-per-query 8 --out ./out
```

CLI Flags:
- `--max-per-query`: Maximum results fetched per query per source (default: `8`).
- `--out`: Output directory for `report.md` and `results.json` (default: `./out`).
- `--cache-dir`: Directory for caching network responses (default: `./.cache`).
- `--no-cache`: Force fresh network requests bypassing cache.

---

## Output Files

- `out/report.md`: Markdown summary highlighting the top 25 scored results with custom "What we could borrow" recommendations and a ranked table of the Top 10 feature ideas.
- `out/results.json`: Full structured JSON database of all discovered and scored candidates.

