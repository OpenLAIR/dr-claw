# Onboarding: rclone + Dropbox + Overleaf Sync

This guide walks you through the full setup from scratch. By the end you will be able to push local LaTeX files to Overleaf with a single `rclone copy` command.

## Prerequisites

- A Dropbox account (free tier is fine)
- An Overleaf account (free or premium)
- A machine where you edit LaTeX locally (Linux, macOS, or WSL)

---

## Step 1: Install rclone

**Linux:**
```bash
curl https://rclone.org/install.sh | sudo bash
```

**macOS (Homebrew):**
```bash
brew install rclone
```

**Verify installation:**
```bash
rclone version
```

You should see something like `rclone v1.68.x` or later.

---

## Step 2: Link Overleaf to Dropbox

This step happens entirely in your browser.

1. Open Overleaf and go to your project.
2. Click the **Overleaf menu** (top-left hamburger icon inside the editor).
3. Scroll down to **Sync** and click **Dropbox**.
4. Overleaf will ask you to authorize access to your Dropbox. Click **Allow**.
5. Once linked, Overleaf creates a folder in your Dropbox at:
   ```
   Dropbox/应用/Overleaf/        (Chinese locale)
   Dropbox/Apps/Overleaf/        (English locale)
   ```
   Each Overleaf project appears as a subfolder (e.g., `Apps/Overleaf/My-Paper/`).

**Note:** The Dropbox integration is available on all Overleaf plans, including free. If you don't see the Dropbox option, check that you are logged into Overleaf and that your browser allows the popup.

---

## Step 3: Configure rclone with Dropbox

Run the interactive config:
```bash
rclone config
```

You will see a menu. Follow these steps:

```
No remotes found, make a new one?
n) New remote
q) Quit config
n/s/q> n

Enter name for new remote.
name> dropbox

Option Storage.
Type of storage to configure.
Choose a number from below, or type in your own value.
...
XX / Dropbox
   \ (dropbox)
...
Storage> dropbox

Option client_id.
Leave blank normally.
client_id>                          [press Enter]

Option client_secret.
Leave blank normally.
client_secret>                      [press Enter]

Edit advanced config?
y/n> n

Use web browser to automatically authenticate rclone with remote?
y/n> y
```

At this point rclone opens your browser for Dropbox OAuth. Log in and click **Allow**. The terminal will print:

```
Got token. Token is {"access_token":"...","token_type":"bearer",...}
Keep this "dropbox" remote?
y/e/d> y
```

**If you are on a headless server (no browser):**

Choose `n` when asked about the web browser, and rclone will give you a URL. Copy it to a machine with a browser, authorize there, and paste the resulting token back.

Alternatively, run `rclone authorize dropbox` on your local machine (which has a browser), get the token, then paste it into the headless server's rclone config.

Verify:
```bash
rclone lsd dropbox:
```

You should see your Dropbox top-level folders listed.

---

## Step 4: Find your Overleaf folder path

```bash
# If your Dropbox locale is English:
rclone lsd "dropbox:/Apps/Overleaf/"

# If your Dropbox locale is Chinese:
rclone lsd "dropbox:/应用/Overleaf/"
```

If neither works, search more broadly:
```bash
rclone lsd "dropbox:/" | grep -i -E "app|应用"
```

You should see your Overleaf projects listed as subdirectories:
```
          -1 2026-01-15 10:00:00        -1 My-Conference-Paper
          -1 2026-02-01 14:30:00        -1 Another-Project
```

Note down the full path, e.g.:
```
dropbox:/Apps/Overleaf/My-Conference-Paper/
```

---

## Step 5: Test the sync

Create or edit a local paper directory:
```
my-paper/
├── main.tex
├── figures/
│   ├── fig1.pdf
│   └── fig2.pdf
└── references.bib
```

Dry-run first (shows what would be copied without actually copying):
```bash
rclone copy ./my-paper/ "dropbox:/Apps/Overleaf/My-Conference-Paper/" --dry-run --verbose
```

If the output looks correct, run for real:
```bash
rclone copy ./my-paper/ "dropbox:/Apps/Overleaf/My-Conference-Paper/" --verbose
```

Within 1-2 minutes, open your Overleaf project. You should see the updated files. If Overleaf doesn't pick up changes immediately, click **Menu > Sync > Dropbox > Pull changes**.

---

## Step 6 (Optional): Exclude build artifacts

LaTeX produces many temporary files that should not be uploaded. Create a filter file:

```bash
cat > ~/.rclone-latex-exclude <<'EOF'
*.aux
*.log
*.synctex.gz
*.fls
*.fdb_latexmk
*.bbl
*.blg
*.out
*.toc
*.lof
*.lot
*.nav
*.snm
*.vrb
__pycache__/**
.DS_Store
EOF
```

Then use it with every sync:
```bash
rclone copy ./my-paper/ "dropbox:/Apps/Overleaf/My-Conference-Paper/" \
  --filter-from ~/.rclone-latex-exclude --verbose
```

---

## Step 7 (Optional): Create a shell alias

Add to your `~/.bashrc` or `~/.zshrc`:

```bash
# Usage: overleaf-sync ./paper/ "My-Conference-Paper"
overleaf-sync() {
  local src="$1"
  local project="$2"
  local remote="${RCLONE_OVERLEAF_REMOTE:-dropbox}"
  local base="${RCLONE_OVERLEAF_BASE:-/Apps/Overleaf}"

  if [ -z "$src" ] || [ -z "$project" ]; then
    echo "Usage: overleaf-sync <local-dir> <overleaf-project-name>"
    return 1
  fi

  rclone copy "$src" "${remote}:${base}/${project}/" \
    --exclude "*.aux" \
    --exclude "*.log" \
    --exclude "*.synctex.gz" \
    --exclude "*.fls" \
    --exclude "*.fdb_latexmk" \
    --exclude "*.bbl" \
    --exclude "*.blg" \
    --exclude "*.out" \
    --exclude ".DS_Store" \
    --verbose
}
```

Then syncing becomes:
```bash
overleaf-sync ./paper/ "My-Conference-Paper"
```

If your Dropbox path uses Chinese locale, override the base:
```bash
export RCLONE_OVERLEAF_BASE="/应用/Overleaf"
```

---

## Troubleshooting

### "directory not found" when listing Overleaf folder
Make sure you have linked Overleaf to Dropbox (Step 2). The `Apps/Overleaf/` or `应用/Overleaf/` folder is only created after the Dropbox integration is enabled in at least one Overleaf project.

### OAuth token expired
```bash
rclone config reconnect dropbox:
```
Follow the browser authorization again. Your existing config (remote name, settings) is preserved.

### Headless server: "Failed to open browser"
Use the manual token flow:
```bash
# On your LOCAL machine (with a browser):
rclone authorize dropbox

# It opens a browser, you authorize, and rclone prints a token blob.
# Copy the entire {"access_token":"...", ...} JSON.

# On the HEADLESS server, run rclone config, and when prompted for
# the token, paste the JSON blob.
```

### Overleaf shows "Merge conflict"
This happens when you edit on both Overleaf and locally at the same time. Overleaf will show a diff and let you choose which version to keep. To avoid this, always pull from Dropbox in Overleaf before editing there, or treat the sync as one-directional (local → Overleaf only).

### Very slow uploads
Dropbox API has rate limits. For large figure files (>10 MB each), uploads may take longer. If transfers stall:
```bash
rclone copy ... --timeout 120s --retries 3 --verbose
```

### "Forced to upload files to set modification times"
This is a harmless Dropbox limitation. Rclone re-uploads unchanged files to update timestamps. The files are not corrupted.
