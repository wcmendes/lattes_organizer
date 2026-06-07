# ComprovaLattes

> 🌐 [Versão em português](README.md)

A client-side Single Page Application (SPA) for managing academic certificates/proofs mapped to Lattes CV entries (CNPq — Brazilian academic curriculum platform). All logic runs in the browser — no backend, no build step.

Uses **Google Sheets** as a database, **Google Drive** for file storage, **PDF.js** + **Tesseract.js** for text extraction, **fuzzball.js** for fuzzy matching, and **JSZip** for ZIP export.

## Prerequisites

- A Google account with access to [Google Cloud Console](https://console.cloud.google.com/)
- A GitHub Pages hosted site (or any static hosting)
- A modern browser (Chrome, Firefox, or Edge)

## Google Cloud Console Setup

### 1. Create a project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a project** → **New Project**
3. Give it a name (e.g., `ComprovaLattes`) and click **Create**

### 2. Enable APIs

In the project dashboard, go to **APIs & Services** → **Library** and enable:

- **Google Sheets API** (v4)
- **Google Drive API** (v3)

### 3. Configure OAuth consent screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** (or Internal if you have Google Workspace)
3. Fill in the app name and support email
4. Add the scopes:
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/drive.file`
5. Add your email as a **Test user** (test mode is fine for personal use)
6. Save

### 4. Create OAuth 2.0 credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Under **Authorized JavaScript origins**, add:
   - `https://yourusername.github.io`
5. Under **Authorized redirect URIs**, add:
   - `https://yourusername.github.io/lattes_organizer/`
6. Click **Create** and copy the **Client ID**

### 5. Configure in the application

Open the **Settings** page in the app (or edit `js/config.js`) and enter:

- The **Client ID** copied from the previous step
- The **Spreadsheet ID** for Google Sheets (can be auto-created by the app)

## Deploy to GitHub Pages

1. Fork or clone this repository:
   ```bash
   git clone https://github.com/yourusername/lattes_organizer.git
   ```

2. In the GitHub repository, go to **Settings** → **Pages**

3. Under **Source**, select the `main` branch and `/ (root)` folder

4. Save and wait for the deploy. The site will be available at:
   ```
   https://yourusername.github.io/lattes_organizer/
   ```

5. Make sure the deploy URL matches the **Authorized JavaScript origin** configured in the Google Cloud Console.

## Usage Guide

### Main Flow

1. **Sign in with Google** — Authenticate on the login screen to authorize Sheets and Drive access
2. **Import Lattes XML** — Go to "Import" and select the XML file exported from the Lattes Platform
3. **Upload certificates** — Upload PDFs or images (JPG/PNG) of your certificates and documents
4. **Review suggestions** — The system extracts text from certificates and suggests automatic associations via fuzzy matching
5. **Manually bind** — For entries without accepted suggestions, manually link the correct certificate
6. **Export** — Export the organized collection to Google Drive or as a ZIP file

### Tips

- Adjust the **confidence threshold** in Settings to control matching sensitivity
- Entries that don't need proof can be marked as **hidden**
- Re-import the XML whenever you update your Lattes CV — previously linked entries are preserved

## File Structure

```
├── index.html                 — Entry point with CDN scripts
├── css/
│   └── styles.css             — Styles (custom properties, responsive)
├── js/
│   ├── app.js                 — Bootstrap, router init, nav bar
│   ├── auth.js                — OAuth2 authentication (Google Identity Services)
│   ├── config.js              — Configuration management
│   ├── router.js              — Hash-based SPA routing
│   ├── core/
│   │   ├── xml-parser.js      — Lattes XML parsing
│   │   ├── text-extractor.js  — Text extraction (PDF.js + Tesseract.js)
│   │   ├── matcher.js         — Fuzzy matching (fuzzball.js)
│   │   ├── exporter.js        — Drive/ZIP export
│   │   ├── category-manager.js — Category management
│   │   ├── entry-manager.js   — Entry CRUD & merge
│   │   ├── review-queue.js    — Review queue (localStorage)
│   │   └── drive-init.js      — Drive folder initialization
│   ├── services/
│   │   ├── sheets.js          — Google Sheets API v4
│   │   └── drive.js           — Google Drive API v3
│   ├── views/
│   │   ├── login.js           — Login screen
│   │   ├── dashboard.js       — Main dashboard
│   │   ├── entries.js         — Entry listing
│   │   ├── import.js          — XML and certificate import
│   │   ├── review.js          — Match review queue
│   │   ├── hidden.js          — Hidden entries
│   │   └── settings.js        — Settings
│   └── ui/
│       ├── toast.js           — Toast notifications
│       └── overlay.js         — Blocking overlay with spinner
├── lib/                       — Local CDN fallbacks
└── test/                      — Unit and property tests
```

## Technologies

| Technology | Purpose |
|---|---|
| Plain HTML/CSS/JS | UI and logic (no framework) |
| Google Identity Services | OAuth2 authentication |
| Google Sheets API v4 | Data persistence |
| Google Drive API v3 | Certificate file storage |
| PDF.js | Text extraction from PDFs |
| Tesseract.js | OCR on images |
| fuzzball.js | Fuzzy matching (token_set_ratio) |
| JSZip | ZIP export |

## License

This project is for personal/academic use.
