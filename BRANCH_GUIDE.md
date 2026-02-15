# Branch guide (for the whole team)

## Branches

This repo uses **three branches**:

| Branch        | Purpose |
|---------------|--------|
| **main**      | Always runnable. Only updated via Pull Requests. |
| **opportunity** | All work for the Opportunity page (data, HTML/CSS, JS). |
| **experts**   | All work for the Experts page (data, HTML/CSS, JS). |

---

## Rules

- **Do not commit directly to `main`.**
- Do your work on **opportunity** or **experts**, then open a Pull Request into **main** when the feature is ready.
- One Pull Request = one feature or task. Keep changes focused.
- Do not commit secrets or local config (e.g. `.env`).

---

## Workflow (everyone)

### 1. Clone and choose your branch

```bash
git clone <repo-url>
cd <project-folder>
git fetch origin
```

- **Opportunity page team** → switch to `opportunity`  
  `git checkout opportunity`
- **Experts page team** → switch to `experts`  
  `git checkout experts`

If the branch doesn’t exist yet on your machine but exists on the remote:

```bash
git fetch origin
git checkout opportunity    # or: git checkout experts
```

If you are creating the branch for the first time (e.g. from current `main`):

```bash
git checkout main
git pull
git checkout -b opportunity   # or: git checkout -b experts
```

### 2. Do your work

Edit files as usual. Save often.

### 3. Commit on your branch

```bash
git status
git add <files you changed>
git commit -m "Short description of what you did"
```

### 4. Push and open a Pull Request

First time pushing this branch:

```bash
git push -u origin opportunity   # or: git push -u origin experts
```

Later:

```bash
git push
```

Then in GitHub (or your Git host):

- Create a **Pull Request** from **opportunity** → **main** (or **experts** → **main**).
- Add a short description. Someone reviews and merges when it’s ready.

### 5. Stay up to date with main

When others merge into `main`, bring those changes into your branch:

```bash
git checkout main
git pull
git checkout opportunity   # or: experts
git merge main
```

Fix any merge conflicts if Git reports them, then commit and push.

---

## Quick reference

| What you want           | Command |
|-------------------------|--------|
| See current branch      | `git branch` |
| Switch to main          | `git checkout main` |
| Switch to Opportunity   | `git checkout opportunity` |
| Switch to Experts       | `git checkout experts` |
| See what’s changed      | `git status` |
| Commit                  | `git add <files>` then `git commit -m "message"` |
| Push your branch        | `git push` (first time: `git push -u origin opportunity` or `experts`) |

---

## Summary

- **main** = stable; only updated via PRs.
- **opportunity** = all Opportunity page work.
- **experts** = all Experts page work.
- Work and commit on **opportunity** or **experts**; merge into **main** via Pull Request when ready.
