#!/usr/bin/env python3
"""
Validate every method file against the taxonomy and build a single data bundle.

    python scripts/build_data.py            # validate + write data/tsad.json
    python scripts/build_data.py --check    # validate only; exit 1 on errors or stale bundle

Why a bundle: the website used to fetch 146 separate JSON files on load. The
bundle is one request, and it is regenerated automatically by the GitHub Action
(.github/workflows/data.yml), so contributors keep editing methods/*.json only.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
METHODS = ROOT / "methods"
TAXONOMY = ROOT / "taxonomy.json"
OUT = ROOT / "data" / "tsad.json"

REQUIRED = ["name", "full_name", "category", "Dim", "Sup", "Stream", "year",
            "authors", "description", "url", "bibtex"]
DIM = {"univariate": "Univariate", "multivariate": "Multivariate"}
SUP = {"unsupervised": "Unsupervised", "semi-supervised": "Semi-supervised",
       "supervised": "Supervised"}


def bibtex_to_str(b):
    """A few files store BibTeX as a JSON object; turn it into a BibTeX string."""
    if isinstance(b, str):
        return b
    if not isinstance(b, dict):
        return ""
    kind = b.get("type", "article")
    authors = b.get("authors") or b.get("author") or []
    if isinstance(authors, list):
        authors = " and ".join(authors)
    first = (authors.split(" and ")[0].split()[-1] if authors else "anon").lower()
    key = re.sub(r"[^a-z0-9]", "", f"{first}{b.get('year', '')}")
    fields = {k: v for k, v in b.items() if k not in ("type", "authors", "author", "keywords")}
    fields = {"author": authors, **fields}
    body = ",\n".join(f"  {k}={{{v}}}" for k, v in fields.items() if v not in ("", None))
    return f"@{kind}{{{key},\n{body}\n}}"


def walk(node, path, out):
    out.append((node["name"], path))
    for c in node.get("children", []):
        walk(c, path + [node["name"]], out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="validate only; fail if bundle is stale")
    args = ap.parse_args()

    errors, warnings = [], []
    taxonomy = json.loads(TAXONOMY.read_text(encoding="utf-8"))
    tree = []
    walk(taxonomy[0], [], tree)
    names = [n for n, _ in tree]
    dupes = {n for n in names if names.count(n) > 1}
    if dupes:
        errors.append(f"taxonomy.json: duplicate node names {sorted(dupes)}")

    files = {p.stem: p for p in METHODS.glob("*.json")}

    # New methods can be added with a single file: a "parent" field places them
    # in the tree without editing taxonomy.json.
    index = {}
    def reindex(n):
        index[n["name"]] = n
        for c in n.get("children", []):
            reindex(c)
    reindex(taxonomy[0])
    pending = [n for n in files if n not in index]
    progress = True
    while pending and progress:
        progress = False
        for n in list(pending):
            try:
                parent = json.loads(files[n].read_text(encoding="utf-8")).get("parent")
            except json.JSONDecodeError:
                continue
            if parent in index:
                index[parent].setdefault("children", []).append({"name": n})
                index[n] = index[parent]["children"][-1]
                pending.remove(n)
                progress = True
                print(f"note: placed {n} under {parent} (from its 'parent' field)")
    for n in pending:
        errors.append(f"methods/{n}.json is not in taxonomy.json and has no valid 'parent' field")
    tree = []
    walk(taxonomy[0], [], tree)
    names = [n for n, _ in tree]

    for n in names:
        if n not in files:
            errors.append(f"taxonomy.json: node '{n}' has no methods/{n}.json")

    nodes = {}
    for name, path in tree:
        p = files.get(name)
        if not p:
            continue
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            errors.append(f"{p.name}: invalid JSON ({e})")
            continue
        is_method = any(k in d for k in ("full_name", "Dim", "authors"))
        d["_path"] = path  # ancestors, root first
        if is_method:
            for k in REQUIRED:
                if k not in d or d[k] in ("", None, []):
                    (errors if k in ("name", "category", "year") else warnings).append(
                        f"{p.name}: missing '{k}'")
            if d.get("name") != name:
                errors.append(f"{p.name}: name '{d.get('name')}' does not match file name")
            # normalise controlled vocabularies
            dim = DIM.get(str(d.get("Dim", "")).lower())
            if not dim:
                errors.append(f"{p.name}: Dim must be Univariate or Multivariate (got {d.get('Dim')!r})")
            else:
                d["Dim"] = dim
            sup = SUP.get(str(d.get("Sup", "")).lower())
            if not sup:
                errors.append(f"{p.name}: Sup must be Unsupervised/Semi-supervised/Supervised (got {d.get('Sup')!r})")
            else:
                d["Sup"] = sup
            if not isinstance(d.get("Stream"), bool):
                errors.append(f"{p.name}: Stream must be true or false")
            if not isinstance(d.get("year"), int):
                errors.append(f"{p.name}: year must be an integer")
            for k in ("url", "code"):
                v = d.get(k)
                if v and not re.match(r"^https?://", v):
                    warnings.append(f"{p.name}: '{k}' is not an http(s) URL: {v}")
            d["bibtex"] = bibtex_to_str(d.get("bibtex"))
            # the taxonomy tree is the source of truth for placement
            tree_cat = path[2] if len(path) > 2 else None
            if tree_cat and d.get("category", "").lower() != tree_cat.lower():
                warnings.append(f"{p.name}: category '{d.get('category')}' but placed under '{tree_cat}' in taxonomy.json")
            d["category"] = tree_cat or d.get("category")
            d["family"] = path[1] if len(path) > 1 else None
        nodes[name] = d

    bundle = {"taxonomy": taxonomy, "nodes": nodes}
    text = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))

    for w in warnings:
        print("warning:", w)
    for e in errors:
        print("ERROR:", e)
    n_methods = sum(1 for d in nodes.values() if "family" in d)
    print(f"{n_methods} methods, {len(nodes) - n_methods} categories, "
          f"{len(errors)} errors, {len(warnings)} warnings")
    if errors:
        sys.exit(1)

    if args.check:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print("data/tsad.json is out of date - run: python scripts/build_data.py")
            sys.exit(1)
        return
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(text) // 1024} KB)")


if __name__ == "__main__":
    main()
