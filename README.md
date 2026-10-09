# MOONLIT — Werewolf room

A tiny, mobile-friendly Werewolf role-dealer. No dependencies and no accounts.

## What it does

- A host enters their name and creates a room.
- The host shares the link (WhatsApp/AirDrop/text) or 6-character room code.
- Friends join on **their own phones**, including the host as a player.
- The host chooses precisely how many **Villagers, Doctors, Seers and Werewolves**.
- When the number of roles equals the number of joined players, the host deals.
- Every player gets **exactly one secret random role** and can tap to reveal or hide it.
- The host can start a fresh round without losing the players.
- No player is shown anybody else's role, including the host.

**Default setup for nine people:** 5 Villagers, 1 Doctor, 1 Seer, 2 Werewolves.

## Publish it online to share one link

The fastest repeatable route is GitHub + Render (or another Node.js hosting provider):

1. Create a new **private or public GitHub repository**, such as `werewolf-room`.
2. Upload the contents of this folder to the repository. **Do not upload just the ZIP** — the files `server.js`, `package.json`, `render.yaml` and the `public` folder should be visible in the repo.
3. On [render.com](https://render.com), create a **Web Service**, connect the repository and select it.
4. Use **Node** as the runtime, **`npm install`** as the build command, and **`npm start`** as the start command. (The included `render.yaml` also contains these settings.)
5. Once the deployment is live, open your new `https://...onrender.com` address, create a room and share its invite link.

You can run it anywhere hosting Node.js 18 or newer, provided the platform accepts incoming HTTP connections and routes all visitors to the same instance.

### Run locally (for testing)

```bash
npm start
```

Visit `http://localhost:3000`. For a live room shared between phones on the same Wi-Fi, run the server on a reachable computer and visit `http://YOUR-COMPUTER-LAN-IP:3000` on the phones. Some mobile browsers restrict the **copy link** feature on non-HTTPS local addresses; the URL/code can still be copied manually. Make sure the computer firewall permits access to port 3000.

## Important limitations

- Rooms exist in server memory only and are cleared if the server restarts or after six hours of inactivity. This is designed for quick party games, **not long-term game storage**.
- Use **one running server instance**. Hosts that run multiple independent instances will have mismatched room states.
- The frontend shows only your own role; the server, not the browser, shuffles and assigns the cards. It's intended for friendly games, not a high-stakes security model.
- This deals secret roles only. A human narrator still manages the night, voting and elimination.
- The host must remain in the room; when the host chooses **Close room**, everyone is removed.

## No paid software required

The app itself has no external dependencies, signup requirement or API keys. Hosting plans and limits may change, so check your chosen hosting provider before creating a service.
