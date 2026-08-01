# Pushing this to GitHub

The commit is already made locally. You just need a remote.

First, get into the project folder — type `cd ` (with the trailing space) and
drag the `core-realty-crm` folder from Finder into Terminal, then Enter.

Check you're in the right place:

```bash
git log --oneline
# 3386600 Core Realty CRM — Phase 1 lead capture
```

---

## Which route?

```bash
gh --version
```

Prints a version → **Route A**. "command not found" → **Route B**.

---

## Route A — GitHub CLI

One command creates the private repo and pushes:

```bash
gh repo create core-realty-crm --private --source=. --remote=origin --push
```

If it says you're not logged in, run `gh auth login` first and follow the
prompts (choose HTTPS, authenticate in the browser).

---

## Route B — browser

1. Go to https://github.com/new
2. Repository name: `core-realty-crm`
3. **Select Private.** Not Public.
4. Do **not** tick "Add a README", "Add .gitignore", or "Choose a license" —
   the repo already has all three, and initialising with them creates a
   conflicting first commit you'd have to merge.
5. Click **Create repository**, then run:

```bash
git remote add origin https://github.com/YOUR-USERNAME/core-realty-crm.git
git push -u origin main
```

Replace `YOUR-USERNAME`. When it asks for a password, GitHub wants a **personal
access token**, not your account password — github.com → Settings → Developer
settings → Personal access tokens → Fine-grained tokens → Generate, with
`Contents: Read and write` on this repo.

---

## Why private

This holds Core Realty's lead schema, your campaign naming conventions, and the
integration logic you're billing for. A public repo also means anyone can read
`SPEC-REVIEW.md`, which is a frank internal critique of the original plan — not
something you want the client finding on their own.

Nothing secret is committed (`.env` is gitignored and no real credentials are in
the history), so a public repo wouldn't leak keys. It would leak commercial
context.

---

## After pushing

Verify the exclusions actually held:

```bash
git ls-files | grep -E '^\.env$|node_modules|\.pgdata' && echo "PROBLEM" || echo "clean"
```

Should print `clean`. If it prints `PROBLEM`, stop and tell me before anyone
else clones it.

Then, on GitHub:

- **Settings → Collaborators** — add only the two developers who need it.
- **Settings → Branches → Add rule** on `main` — require a pull request. With
  two devs sharing one branch you will otherwise get force-push accidents.

---

## Handing it to the developers

Point them at these in order:

1. `SPEC-REVIEW.md` — what changed from the original spec and why. Read first.
2. `README.md` — build order. **Week 1 is deploy + submit Meta app review**,
   not feature work. Meta's reviewers test your live HTTPS endpoint, and a 404
   there resets the clock.
3. `npm install && npm run test:e2e` — 36 checks, no ad accounts or Postgres
   needed. If those pass on their machine, their environment is correct.

---

## Before Phase 2 opens

Add a `LICENSE` or an explicit copyright header stating who owns this code.
Right now the repo says nothing about ownership. If the Core Realty
relationship ends badly, "who owns the CRM" becomes a real argument and an
empty repo is not a position. Settle it in the retainer and reflect it here.
