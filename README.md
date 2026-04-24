# 🪝 PhantomHook 

**Real-Time Phishing & Threat Detection System**

Let's be honest: static blacklists just aren't fast enough to stop modern, zero-day phishing attacks. By the time a malicious URL is reported, the damage is already done. 

PhantomHook is a proactive, Manifest V3 browser extension built to intercept these threats in real-time. Instead of just checking if a URL is "known to be bad," PhantomHook uses a **two-tier architecture**. It acts as a local machine-learning "bouncer" to instantly flag suspicious links, and then tags in a massive cloud-based LLM (NVIDIA Nemotron) to actually read and understand the website's live code the second it loads.

---

## 🧠 How It Works: The 7-Layer Pipeline

PhantomHook doesn't just guess; it runs websites through a rigorous, asynchronous gauntlet. Safe sites pass through instantly without lagging your browser, while sketchy sites get escalated up the chain:

1. **The VIP List (Local Safe/Blacklists):** Instant $O(1)$ checks against known safe and malicious domains so we don't waste computing power.
2. **The Burner Check (WHOIS Domain Age):** Phishers love spinning up new domains. We flag any infrastructure registered in the last 48 hours.
3. **The Vibe Check (Lexical Analysis):** Scans the live URL for classic spoofing patterns and desperate keywords (e.g., `login-update-security-now`).
4. **The Local Bouncer (ONNX ML Inference):** A lightweight, local machine-learning model scores the site. If it crosses our threat threshold, we lock the doors and call the backend.
5. **Reading the Room (Real-Time DOM Analysis):** The extension actually scrapes the live HTML on page load to hunt for hidden password fields, cross-origin forms, and brand spoofing.
6. **Calling for Backup (Threat Intel):** We run the hashes against the VirusTotal API to see if other security vendors have flagged it.
7. **The Big Brain (LLM Synthesis):** The ultimate failsafe. We feed the extracted HTML, WHOIS data, and ML scores to the **NVIDIA Nemotron-3-Super-120B** model via OpenRouter. The AI reasons through the context and hands down an immediate JSON verdict: `ALLOW` or `BLOCK`.

---

## 🛠️ What's Under the Hood

* **Frontend (The Extension):** JavaScript, Manifest V3, HTML/CSS
* **Backend (The Brains):** Python, FastAPI
* **Hosting:** Render (Cloud Backend)
* **AI & Machine Learning:** ONNX Runtime (Local), NVIDIA Nemotron 120B (Cloud LLM)
* **APIs:** OpenRouter, VirusTotal, Python-Whois

---

## 🚀 Get It Running

### 1. Fire up the Backend API
1. Clone this repository to your local machine.
2. Install the dependencies: `pip install fastapi uvicorn requests python-whois pydantic`
3. Set up your environment variables (don't push these to GitHub!):
   * `OPENROUTER_API_KEY`
   * `VIRUSTOTAL_API_KEY`
4. Run the FastAPI server locally: `uvicorn main:app --reload`
*(Note: For the production build, this backend is hosted on Render).*

### 2. Load the Browser Extension
1. Open up Microsoft Edge or Google Chrome.
2. Head over to `edge://extensions/` or `chrome://extensions/`.
3. Flip the **Developer Mode** switch to ON.
4. Click **Load unpacked** and select the `phantomhook-extension` folder.
5. Make sure the backend URL in `background.js` is pointing to your backend instance.

---

## 🧪 Safe Demo Mode

Live phishing sites get taken down fast, making consistent testing difficult. To safely demonstrate the architecture without interacting with live malware, PhantomHook includes a built-in **Deterministic Test Endpoint**. 

Just navigate to any website and add our demo tag to the URL:
`https://example.com/?demo-phish`

This manually triggers the real-time Layer 7 AI Block, dropping the red lockdown screen and proving the asynchronous interception pipeline works perfectly in a safe environment.

---

## 💻 The Developer

* **Developed by:** Mohd Taha Azam
* **Core Focus:** MV3 pipeline integration, real-time DOM scraping architecture, FastAPI routing, and LLM prompt engineering.
