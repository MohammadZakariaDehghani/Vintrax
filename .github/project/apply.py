#!/usr/bin/env python3
"""Apply .github/project/labels.yml and milestones.yml to the repository.

Run by .github/workflows/project-setup.yml. Creates what is missing, corrects
what has drifted, and never deletes: an entry that exists on GitHub but not in
a manifest is left alone, because removing a label strips it from every issue
carrying it and that should be a deliberate act, not a side effect of a
manifest edit.

Idempotent by construction — every run ends in the same state, so re-running
after a failed run is safe.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

import yaml

API = "https://api.github.com"
REPO = os.environ["REPO"]
TOKEN = os.environ["GITHUB_TOKEN"]
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

HERE = pathlib.Path(__file__).parent

created = 0
updated = 0
unchanged = 0


def request(method: str, path: str, body: dict | None = None):
    """One GitHub API call. Returns (status, parsed body)."""
    url = path if path.startswith("http") else f"{API}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data is not None:
        req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req) as response:
            payload = response.read()
            return response.status, (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as error:
        payload = error.read()
        # 404 is an answer, not a failure, when asking whether something exists.
        if error.code == 404:
            return 404, None
        print(f"::error::{method} {url} -> {error.code} {payload.decode()[:400]}")
        raise


def note(action: str, kind: str, name: str) -> None:
    global created, updated, unchanged
    if action == "create":
        created += 1
    elif action == "update":
        updated += 1
    else:
        unchanged += 1
    prefix = "would " if DRY_RUN and action != "keep" else ""
    verb = {"create": "create", "update": "update", "keep": "unchanged"}[action]
    print(f"  {prefix}{verb}: {kind} {name}")


def apply_labels() -> None:
    manifest = yaml.safe_load((HERE / "labels.yml").read_text())["labels"]
    print(f"Labels ({len(manifest)} in manifest)")

    for entry in manifest:
        name = entry["name"]
        colour = entry["color"].lstrip("#").lower()
        description = (entry.get("description") or "").strip()

        status, existing = request("GET", f"/repos/{REPO}/labels/{urllib.parse.quote(name)}")

        if status == 404:
            note("create", "label", name)
            if not DRY_RUN:
                request(
                    "POST",
                    f"/repos/{REPO}/labels",
                    {"name": name, "color": colour, "description": description},
                )
            continue

        drifted = (
            existing["color"].lower() != colour
            or (existing.get("description") or "").strip() != description
        )
        if not drifted:
            note("keep", "label", name)
            continue

        note("update", "label", name)
        if not DRY_RUN:
            request(
                "PATCH",
                f"/repos/{REPO}/labels/{urllib.parse.quote(name)}",
                {"new_name": name, "color": colour, "description": description},
            )


def apply_milestones() -> None:
    manifest = yaml.safe_load((HERE / "milestones.yml").read_text())["milestones"]
    print(f"\nMilestones ({len(manifest)} in manifest)")

    # Milestones have no lookup-by-title endpoint, so the full list is fetched
    # once and matched here. `state=all` matters: without it a closed milestone
    # is invisible and this would try to create a duplicate.
    existing_by_title: dict[str, dict] = {}
    page = 1
    while True:
        _, batch = request(
            "GET", f"/repos/{REPO}/milestones?state=all&per_page=100&page={page}"
        )
        if not batch:
            break
        for milestone in batch:
            existing_by_title[milestone["title"]] = milestone
        if len(batch) < 100:
            break
        page += 1

    for entry in manifest:
        title = entry["title"]
        description = " ".join((entry.get("description") or "").split())
        existing = existing_by_title.get(title)

        if existing is None:
            note("create", "milestone", title)
            if not DRY_RUN:
                request(
                    "POST",
                    f"/repos/{REPO}/milestones",
                    {"title": title, "state": entry.get("state", "open"), "description": description},
                )
            continue

        # The state is deliberately not reconciled. Closing a milestone is a
        # decision about whether the work is done, and the manifest is not
        # entitled to reopen one somebody closed on purpose.
        if (existing.get("description") or "").strip() == description:
            note("keep", "milestone", title)
            continue

        note("update", "milestone", title)
        if not DRY_RUN:
            request(
                "PATCH",
                f"/repos/{REPO}/milestones/{existing['number']}",
                {"description": description},
            )


def main() -> int:
    if DRY_RUN:
        print("Dry run — nothing will be written.\n")

    apply_labels()
    apply_milestones()

    print(f"\nCreated {created}, updated {updated}, already correct {unchanged}.")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(
                f"### Project setup\n\n"
                f"{'Dry run. ' if DRY_RUN else ''}"
                f"Created **{created}**, updated **{updated}**, "
                f"already correct **{unchanged}**.\n"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
