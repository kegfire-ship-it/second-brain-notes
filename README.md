# Second Brain Notes

A notes app that runs on your own machine instead of someone else's cloud. With it you can:

- write notes and organize them with categories and colors;
- paste a YouTube or Instagram link and get the main ideas or step-by-step instructions from the video;
- search by meaning: searching for "what to cook for dinner" finds your recipe note even if the word "dinner" isn't in it;
- connect your notes to Claude, so it can read, search and create them for you.

There are two ways to install it.

| | On your own server | On your own computer |
|---|---|---|
| Where it opens | On any device, including your phone | Only on that computer |
| Cost | Server rental, about €5–7 a month | Free |
| Good for | Everyday use | Trying it out |

A server here means a computer you rent on the internet that stays on around the clock. It keeps your notes available even when your laptop is off.

## What you need

1. **The Claude app.** Download it from [claude.ai/download](https://claude.ai/download), install it and sign in. You need a paid Claude plan. In the app, click **Code** at the top of the sidebar: this is the part of Claude that can install programs on your computer, and it will walk you through the installation.

2. **The Claude extension for Chrome.** With it, Claude opens the right websites for you and shows you where to click. Install it from [claude.com/claude-for-chrome](https://claude.com/claude-for-chrome). The extension only works in Google Chrome and on paid Claude plans. You can install without it too: Claude will send links in the chat and you open them yourself.

## Install on a server

Open the Code tab of the Claude app and paste the whole text from the block below. Claude will then tell you what to do, one step at a time.

Only you enter passwords, payment details and keys, and Claude doesn't see them. That's why it will sometimes ask you to type something yourself and then write "done".

```text
Help me install the Second Brain Notes app on my own server.
Instructions and code: https://github.com/kegfire-ship-it/second-brain-notes

I'm not a programmer. Use plain language and give me one step at a time. Explain every
new word in one sentence, and before each step say why it's needed. After each step,
wait until I write "done". If you have the Claude in Chrome tools, open pages for me
and look at what's on the screen. If you don't, send me links.

Safety rules, follow them strictly:
- Only I enter passwords, card details and keys. Never ask me to send them in the chat.
  If I send one by accident, tell me to replace that key or password.
- Don't create accounts or pay for me. Open the page, tell me what to fill in, and wait.
- I run the server install command myself in a separate Terminal window, because it
  asks for keys and a password.

Steps:

1. Briefly explain what's ahead: a server rental of about €5–7 a month (the payment page
   will show the exact amount and minimum term), a free Gemini key, Instagram is optional.
   The whole installation takes 30–40 minutes. Ask if I'm ready to start.

2. Gemini key. The app needs it to understand videos and search by meaning.
   Open https://aistudio.google.com/apikey. I sign in to Google and create a key.
   Tell me to copy the key and keep it somewhere safe, such as the password manager
   built into my phone or computer, and not to send it in the chat.

3. Instagram, optional. Ask if I want ideas from Instagram. If not, skip this step.
   If yes: open https://console.apify.com/sign-up so I can register, then open
   https://console.apify.com/settings/integrations and tell me to copy the Personal API
   token the same way as the Gemini key. Apify has a free monthly allowance, which is
   usually enough for personal use.

4. Server. Open https://contabo.com/en/vps/ and guide me through the order: the cheapest
   Cloud VPS plan, a region in Europe or closer to me, the Ubuntu 24.04 operating system.
   If the order page asks for a root password (root is the server's main user), tell me
   to choose a strong one and save it. Before payment, show me the total and the term;
   I pay myself. Warn me that preparing the server takes from a few minutes to a few
   hours and that an email with the details will arrive.
   Ask me to send you the server's IP address, which is its number on the internet (four
   numbers separated by dots). It's in the email and in the Contabo panel. An IP address
   isn't secret.

5. Launch. Write me one ready-made command, putting the server's IP address in place
   of SERVER_IP:

   ssh -t root@SERVER_IP "apt-get update -y && apt-get install -y git curl && (git clone https://github.com/kegfire-ship-it/second-brain-notes /opt/second-brain-notes || git -C /opt/second-brain-notes pull) && bash /opt/second-brain-notes/install.sh"

   Explain in advance:
   - how to open Terminal, a window for typing commands (on a Mac it's in Applications,
     then Utilities; on Windows use PowerShell), then paste the command and press Enter;
   - if it asks about a fingerprint, type yes;
   - then enter the server password; nothing appears while typing, and that's expected;
   - next the installer asks for the Gemini key and the Apify token (which can be
     skipped) and asks me to choose a password for my notes;
   - at the end it shows the address of my notes.

6. Check. Ask me to open the address from the last message and sign in. Three starter
   notes will be waiting there. Suggest opening the one called "Try it: main ideas from
   a video" and pressing Main ideas. If something doesn't work, ask me to show you the
   error text, without keys or passwords.

7. Connect to Claude. Explain that this lets Claude find, summarize and save my notes.
   Ask me to open my notes on this computer, open the menu in the top right, choose
   Connect to Claude, press Copy message, and paste the message here in this chat. It
   contains a private key, and it's the one exception to the rule about keys, because
   it's made to be given to Claude. Do what the message says yourself: don't send me to
   Terminal for this.
   Then check: ask me to start a new session in the Code tab and ask what notes I have.

8. Tell me that the notes are stored on the server in /opt/second-brain-notes/data
   and that the same command from step 5 updates the app.
```

## Install on your computer

Works on Mac and Linux. Open the Code tab of the Claude app and paste:

```text
Help me install the Second Brain Notes app on this computer.
Code: https://github.com/kegfire-ship-it/second-brain-notes
I'm not a programmer: use plain language, one step at a time, and explain new words.
Only I enter keys and passwords, so don't ask me to send them in the chat.

1. Download the code to the ~/second-brain-notes folder. Check whether git and Node.js
   are installed. If Node.js is missing, open https://nodejs.org and tell me what to
   download and install.
2. Open https://aistudio.google.com/apikey so I can create a free Gemini key and copy it.
3. Tell me how to open Terminal, a window for typing commands, and ask me to run:
   bash ~/second-brain-notes/install-local.sh
   Warn me that it will ask for the key and ask me to choose a password, and that
   nothing appears on screen while typing.
4. Open http://localhost:3210 for me. Three starter notes will be waiting there: help
   me try the first one.
5. Connect to Claude. Explain that this lets Claude find, summarize and save my notes.
   Ask me to open my notes on this computer, open the menu in the top right, choose
   Connect to Claude, press Copy message, and paste the message here in this chat. It
   contains a private key, and it's the one exception to the rule about keys, because
   it's made to be given to Claude. Do what the message says yourself: don't send me to
   Terminal for this.
   Then check: ask me to start a new session in the Code tab and ask what notes I have.
```

## Connect your notes to Claude

Once connected, Claude can work with your notes for you. You can write "find my notes about marketing", "summarize what I saved this month" or "save this as a new note" in the Code tab of the Claude app.

To set this up, open your notes on the computer where you have the Claude app. Open the menu in the top right and choose **Connect to Claude**, then press **Copy message**. Paste that message into the Code tab of the Claude app and send it. Claude will set up the connection by itself.

The message contains a private key that opens your notes, so paste it only into your own Claude app.

To check that it worked, start a new session in the Code tab and write "What notes do I have?".

## If something goes wrong

Show Claude the error text and ask what to do. Don't show keys or passwords.

The Claude connection works in the Code tab of the Claude app. It won't appear in the regular chat on claude.ai.
