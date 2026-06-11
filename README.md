# RieadLiveFIFA ⚽🔥

A premium, secure, and modern live web dashboard designed to host your personal live casting feeds from OBS Studio. Built to deploy instantly to Render.

## Features
- **Sleek Premium Design**: Dark mode with neon glowing colors, micro-animations, and clean typography.
- **HTML5 Player**: Cast custom private video feeds (MP4, HLS, `.m3u8`) securely.
- **Simulated Chat**: Interactive guest chat simulation to simulate viewer engagement.
- **Buffer-free Setup**: Optimized static rendering.

---

## 🛠️ Step-by-Step Setup Guide

### Part 1: Uploading to GitHub
1. Open Git Bash or terminal on your PC.
2. Go to the project directory:
   ```bash
   cd C:\rieadlivefifa
   ```
3. Initialize the repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit for RieadLiveFIFA"
   ```
4. Create a new repository on your GitHub account named `rieadlivefifa`.
5. Link your local project to GitHub and push:
   ```bash
   git remote add origin https://github.com/YOUR_GITHUB_USERNAME/rieadlivefifa.git
   git branch -M main
   git push -u origin main
   ```

### Part 2: Deploying to Render
1. Go to [Render](https://render.com) and log in.
2. Click **New +** and select **Web Service**.
3. Connect your GitHub account and choose the `rieadlivefifa` repository.
4. Set the following configurations:
   - **Name**: `rieadlivefifa`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Click **Deploy Web Service**. Render will build and host your website in a few minutes!

### Part 3: Stream live using OBS
1. Open **OBS Studio**.
2. Go to **Settings** > **Stream**.
3. Set **Service** to `Custom...`.
4. Enter your RTMP server details (e.g., from a free CDN provider or streaming service you use) and cast it to your website URL.
