import BaseHTMLElement from "./BaseHTMLElement.js";

export class GamePage extends BaseHTMLElement {
  constructor() {
    super("gamepage");
    this.matchmakingSocket = null;
    this.gameState = "idle";
  }

  connectedCallback() {
    super.connectedCallback();
    this.render();
    this.setupEventListeners();
  }

  render() {
    this.innerHTML = `
		<div class="game-wrapper">
		<div class="game-container">
		<div class="game-info">
			<h1 class="game-title">Experience Pong Like Never Before</h1>
			<p class="game-subtitle">Challenge players worldwide in real-time matches. Compete in tournaments and climb the global leaderboards.</p>
			
			<div class="btn-container">
			<button id="requestGameBtn" class="btn btn-primary">Quick Match</button>
			<button id="createTournament" class="btn btn-secondary">Create Tournament</button>
			<button id="cancelMatchmakingBtn" class="btn btn-danger" disabled>Cancel Match</button>
			</div>
			
			<div id="matchmakingStatus" class="status-message"></div>
		</div>
		
		<div class="game-visual">
			<div class="game-instructions">
			<h2>Game Controls</h2>
			<ul class="instruction-list">
				<li>Press W key to move paddle upward</li>
				<li>Press S key to move paddle downward</li>
				<li>Score 11 points to win the match</li>
			</ul>
			</div>
		</div>
		</div>
	</div>
    `;
  }

  setupEventListeners() {
    const requestGameBtn = this.querySelector("#requestGameBtn");
    const cancelMatchmakingBtn = this.querySelector("#cancelMatchmakingBtn");
    const createTournamentBtn = this.querySelector("#createTournament");

    requestGameBtn.addEventListener("click", () => this.requestGame());
    cancelMatchmakingBtn.addEventListener("click", () =>
      this.cancelMatchmaking()
    );
    createTournamentBtn.addEventListener("click", () =>
      app.router.go("/tournament", false)
    );
  }

  async requestGame() {
    try {
      const response = await fetch("/api/play/request-game/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        mode: "cors",
      });

      const data = await response.json();

      if (response.ok) {
        this.updateStatus("Connecting to matchmaking...");
        this.connectToMatchmaking(data.websocket_url);
      } else {
        this.updateStatus(`Error: ${data.message}`, "error");
      }
    } catch (error) {
      this.updateStatus(`Error: ${error.message}`, "error");
    }
  }

  connectToMatchmaking(websocketUrl) {
    websocketUrl = websocketUrl.replace(/\/$/, "");
    this.matchmakingSocket = new WebSocket(
      `wss://${window.location.host}${websocketUrl}/`
    );

    this.matchmakingSocket.onopen = () => {
      this.updateStatus("Waiting for opponent...", "waiting");
      this.toggleButtons(true);
    };

    this.matchmakingSocket.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.status === "matched") {
        this.updateStatus(`Matched! Preparing game...`, "success");
        this.matchmakingSocket.close();
        this.startGame(data.game_id);
      }
    };

    this.matchmakingSocket.onclose = () => {
      if (this.gameState === "matchmaking") {
        this.updateStatus("Disconnected from matchmaking", "error");
        this.toggleButtons(false);
      }
    };
  }

  cancelMatchmaking() {
    if (
      this.matchmakingSocket &&
      this.matchmakingSocket.readyState === WebSocket.OPEN
    ) {
      this.matchmakingSocket.send(
        JSON.stringify({ action: "cancel_matchmaking" })
      );
      this.matchmakingSocket.close();
    }
    this.updateStatus("Matchmaking cancelled", "info");
    this.toggleButtons(false);
  }

  updateStatus(message, type = "info") {
    const statusElement = this.querySelector("#matchmakingStatus");
    statusElement.textContent = message;
    statusElement.className = `status-message ${type}`;
  }

  toggleButtons(isMatchmaking) {
    const requestGameBtn = this.querySelector("#requestGameBtn");
    const createTournamentBtn = this.querySelector("#createTournament");
    const cancelMatchmakingBtn = this.querySelector("#cancelMatchmakingBtn");

    requestGameBtn.disabled = isMatchmaking;
    createTournamentBtn.disabled = isMatchmaking;
    cancelMatchmakingBtn.disabled = !isMatchmaking;
    this.gameState = isMatchmaking ? "matchmaking" : "idle";
  }

  startGame(gameId) {
    app.router.removeOldPages();
    app.router.insertPage("game-screen");
    const gameScreen = document.querySelector("game-screen");
    gameScreen._setGameId = gameId;
  }
}

customElements.define("game-page", GamePage);
