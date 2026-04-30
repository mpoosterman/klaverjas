# Klaverjas Online

A real-time multiplayer Klaverjas card game for 2, 3, or 4 players.

## Features
- Real-time multiplayer via Socket.io
- 2, 3, or 4 players per room
- Room codes for easy sharing
- Full Klaverjas rules including roem scoring
- Trump King+Queen bonus (stuk) — stacks with sequences
- Last trick bonus (10 pts)
- Playing team forfeits roem if they lose the round

---

## How to run locally

### 1. Install Node.js
Download and install Node.js from https://nodejs.org (choose the LTS version).

### 2. Install dependencies
Open a terminal in this folder and run:
```
npm install
```

### 3. Start the server
```
npm start
```

### 4. Open the game
Open your browser and go to: http://localhost:3000

---

## How to deploy on Railway (free hosting)

1. Create a free account at https://railway.app
2. Install Git from https://git-scm.com if you don't have it
3. Create a GitHub account at https://github.com if you don't have one
4. Upload this folder to a new GitHub repository
5. In Railway: click "New Project" → "Deploy from GitHub repo"
6. Select your repository — Railway will detect Node.js automatically
7. Once deployed, Railway gives you a public URL to share with friends!

---

## Project structure

```
klaverjas/
├── package.json          # Node.js configuration
├── src/
│   ├── server.js         # Express + Socket.io server
│   ├── gameLogic.js      # Card game rules engine
│   └── roomManager.js    # Room and game state management
└── public/
    ├── index.html        # Game interface
    ├── css/style.css     # Styling
    └── js/game.js        # Client-side game code
```

---

## Scoring rules

| Combination | Points |
|---|---|
| Sequence of 3 (same suit) | 20 |
| Sequence of 4+ (same suit) | 50 |
| Three of a kind | 20 |
| Four of a kind | 50 |
| King + Queen of trumps (stuk) | 20 |
| Winning the last trick | 10 |

- If the King+Queen of trumps are part of a longer sequence, both scores count.
- If the playing team loses the round, their roem is transferred to the winning team.
- First team to reach 1500 points wins the game.
