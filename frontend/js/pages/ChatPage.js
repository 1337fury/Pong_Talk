import BaseHTMLElement from "./BaseHTMLElement.js";
import { createState } from "../utils/stateManager.js";
import { displayRequestStatus } from "../utils/errorManagement.js";

export class ChatPage extends BaseHTMLElement {
  constructor() {
    super("chatpage");
    const { state, registerUpdate } = createState({
      conversations: [],
      friends: [],
    });

    this.state = state;
    this.chatSocket = null;
    this.openedConversations = {};
    this.prevOpenedConversation = null;
    this.registerUpdate = registerUpdate;
    this.registerLocalFunctions();
  }

  connectedCallback() {
    super.connectedCallback();
    // Add additional logic for the chat page ...
    app.api.get("/api/conversations/").then((response) => {
      if (response.status >= 400) {
        displayRequestStatus("error", response.data);
        return;
      }
      this.state.conversations = response.data;
    });
    this.popupConversationActions();
    this.searchFriends();
    this.searchConversations();
    this.setupWebsocket();
  }

  disconnectedCallback() {
    this.isDisconnected = true;
    this.chatSocket.close();
  }

  setupWebsocket() {
    this.chatSocket = new WebSocket(
      "wss://" + window.location.host + "/ws/chat/"
    );

    this.chatSocket.onopen = (e) => {
      console.log("Chat socket open");
    };

    this.chatSocket.onmessage = (e) => {
      const data = JSON.parse(e.data);
      const conversation = this.state.conversations.find(
        (conversation) =>
          conversation.conversationID === data.message.conversation_id
      );
      if (!conversation) {
        // retrieve the conversation from the server and update the state
        app.api
          .get("/api/conversations/" + data.message.conversation_id)
          .then((response) => {
            if (response.status >= 400) {
              displayRequestStatus("error", response.data);
              return;
            }
            this.state.conversations = [response.data, ...this.state.conversations];
          });
      }
      this.moveConversationToTop(data.message.conversation_id, data.message.data);

      if (this.openedConversations[data.message.conversation_id] === undefined) {
        this.openedConversations[data.message.conversation_id] = false;
      }

      // If the conversation is opened then add the message to the chat message
      if (this.openedConversations[data.message.conversation_id]) {
        const chatMessage = this.querySelector("chat-message");
        chatMessage.state.messages = [
          ...chatMessage.state.messages,
          data.message.data,
        ];

        // mark message as read if the conversation is opened
        app.api.patch("/api/conversations/" + conversation.conversationID + "/messages/" + data.message.data.messageID + "/mark_as_read/")
        // return;
      }

      // Play sound notification
      const audio = new Audio('/assets/livechat.mp3');
      audio.play();

      // If the conversation is not opened then add a notification
      this.notificationConversationMonitor(data.message.conversation_id, this.openedConversations[data.message.conversation_id]);
    };

    this.chatSocket.onclose = (e) => {
      // reconnect the websocket if the parent page is still open
      if (!this.isDisconnected) {
        console.log("Reconnecting chat socket...");
        this.setupWebsocket();
        return;
      }
      console.log("Chat socket closed");
    };
  }



  notificationConversationMonitor(conversation_id, isOpened = false) {
    const conversationContainer = this.querySelector(
      ".direct_message_container"
    );
    const conversationElement = conversationContainer.querySelector(
      `[data-conversation-id="${conversation_id}"]`
    );
    const notificationElement = conversationElement.querySelector(
      ".direct_message_notification_icon"
    );
    notificationElement.classList.toggle("style", !isOpened);
    notificationElement.textContent = isOpened
      ? ""
      : parseInt(notificationElement.textContent ? notificationElement.textContent : "0") + 1;
  }

  moveConversationToTop(conversation_id, message) {
    const conversationContainer = this.querySelector(
      ".direct_message_container"
    );
    const conversationElement = conversationContainer.querySelector(
      `[data-conversation-id="${conversation_id}"]`
    );
    const conversationText = conversationElement.querySelector(
      ".direct_message_text"
    );
    conversationText.textContent =
      message.content;
    // update the last message of the conversation and move it to the top in the conversation list
    const conversationIndex = this.state.conversations.findIndex(
      (conversation) => conversation.conversationID === conversation_id
    );
    this.state.conversations[conversationIndex].last_message =
      message.content;

    // Remove the conversation from its current position
    const [conversation] = this.state.conversations.splice(
      conversationIndex,
      1
    );

    // Add the conversation to the beginning of the array
    this.state.conversations.unshift(conversation);
    // check if the conversation is already at the top
    if (conversationContainer.firstElementChild === conversationElement) {
      return;
    }
    conversationContainer.removeChild(conversationElement);
    conversationContainer.prepend(conversationElement);
  }

  registerLocalFunctions() {
    this.registerUpdate("conversations", this.updateUIConversations.bind(this));
    this.registerUpdate("friends", this.updateUIfriends.bind(this));
  }

  setConversationsActions() {
    const conversationButtons = this.querySelectorAll(".direct_message_btn");

    conversationButtons.forEach((button) => {
      const conversationID = button.getAttribute("data-conversation-id");
      this.openedConversations[conversationID] = false;
      button.addEventListener("click", (event) => {
        if (this.openedConversations[conversationID]) {
          return;
        }
        if (this.prevOpenedConversation) {
          const prevConversationBtn = this.querySelector(`.direct_message_btn[data-conversation-id='${this.prevOpenedConversation}']`);
          prevConversationBtn.classList.remove("active");
          this.openedConversations[this.prevOpenedConversation] = false;
        }

        this.prevOpenedConversation = conversationID;
        this.openedConversations[conversationID] = true;

        const conversationIndex = this.state.conversations.findIndex(
          (conversation) => conversation.conversationID == conversationID
        );
        // add style to the selected conversation
        button.classList.add("active");
        this.openConversationEvent(conversationIndex);
        this.notificationConversationMonitor(conversationID, true);
      });
    });
  }

  openConversationEvent(index) {
    const chatContainer = this.querySelector(".chat_message_container");
    const chatMessageElement = document.createElement("chat-message");

    const currentConversation = this.state.conversations[index];
    chatMessageElement.conversation = {
      id: currentConversation.conversationID,
      IsBlockedByMe: currentConversation.IsBlockedByMe,
      IsBlockedByOtherPlayer: currentConversation.IsBlockedByOtherPlayer,                                                                                                                                                                   
      player: this.choosePlayerConversation(currentConversation),
    };
    if (chatContainer.lastElementChild.nodeName === "CHAT-MESSAGE") {
      chatContainer.removeChild(chatContainer.lastElementChild);
    }
    chatContainer.appendChild(chatMessageElement);
  }

  popupConversationActions() {
    const popupContainer = this.querySelector(".popup-container");
    this.querySelector(".add-conversation-btn").addEventListener(
      "click",
      (event) => {
        popupContainer.classList.remove("hidden");
        app.api.get("/api/friendships/").then((response) => {
          if (response.status >= 400) {
            displayRequestStatus("error", response.data);
            return;
          }
          this.state.friends = response.data;
        });
      }
    );

    popupContainer.addEventListener("click", (event) => {
      event.target.classList.add("hidden");
      const searchInput = this.querySelector(
        "input[name='popup-search-players']"
      );
      searchInput.value = "";
    });
  }

  updateUIfriends(searchFriends = null) {
    const popupFriends = this.querySelector(".popup-friends");

    const friendsToDisplay = searchFriends ? searchFriends : this.state.friends;
    const popupBtns = friendsToDisplay.map((friend) => {
      const player = this.choosePlayerFriend(friend);
      return `
      <button
      class="popup-btn w-100 border border-secondary-subtle border-top-0 border-end-0 border-start-0 text-start ps-4 pt-2 pb-2"
      data-friend-username='${player.username}'
    >
      <div class="avatar me-2">
        <img
          class="avatar_image shadow-sm"
          src="${player.avatar_url}"
          alt="Avatar image"
        />
        <span class="avatar_status ${player.isFriend ? "" : "none"} ${player.online ? "online" : ""}"></span>
      </div>
      ${player.first_name} ${player.last_name}
    </button>
      `;
    });
    popupFriends.innerHTML = popupBtns.join("");
    this.addNewConversationFromPopup();
  }

  addNewConversationFromPopup() {
    const popupBtns = this.querySelectorAll(".popup-btn");
    popupBtns.forEach((button) => {
      button.addEventListener("click", (event) => {
        const popupContainer = this.querySelector(".popup-container");
        const username = button.getAttribute("data-friend-username");
        const friendship = this.state.friends.find(
          (friend) => friend.player1.username === username || friend.player2.username === username
        );

        const player = this.choosePlayerFriend(friendship);

        this.createTemporayConversationOrOpenExistingOne(player);
        popupContainer.classList.add("hidden");
        const searchInput = this.querySelector(
          "input[name='popup-search-players']"
        );
        searchInput.value = "";
      });
    });
  }

  // create a temporary conversation with the player but not saved in the database
  createTemporayConversationOrOpenExistingOne(player) {
    // search the player in the conversation
    const existConversation = this.state.conversations.find(
      (conversation) =>
        conversation.player1.username === player.username ||
        conversation.player2.username === player.username
    );
    if (existConversation) {
      // if the conversation already exists, open it
      const conversationBtn = this.querySelector(
        "button[data-conversation-id='" +
          existConversation.conversationID +
          "']"
      );
      conversationBtn.click();
    } else {
      const chatMessage = document.createElement("chat-message");
      const chatContainer = this.querySelector(".chat_message_container");
      if (chatContainer.lastElementChild.nodeName === "CHAT-MESSAGE") {
        if (chatContainer.lastElementChild._conversation.player.username === player.username) {
          return;
        }
        chatContainer.removeChild(chatContainer.lastElementChild);
      }
      chatMessage._conversation.id = 0;
      chatMessage._conversation.player = player;
      if (this.prevOpenedConversation) { // close the previous conversation if exists
        const prevConversationBtn = this.querySelector(`.direct_message_btn[data-conversation-id='${this.prevOpenedConversation}']`);
        prevConversationBtn.classList.remove("active");
        this.openedConversations[this.prevOpenedConversation] = false;
      }
      chatContainer.appendChild(chatMessage);
    }
  }

  searchConversations() {
    const searchInput = this.querySelector(
      "input[name='search-conversations']"
    );
    searchInput.addEventListener("input", (event) => {
      const searchValues = event.target.value.split(' ').filter(Boolean);

      const searchConversations = this.state.conversations.filter(
        (conversation) => {
          const player = this.choosePlayerConversation(conversation);
          const playerName = (player.first_name + ' ' + player.last_name).toLowerCase();
          return searchValues.every(value => playerName.includes(value.toLowerCase()));
        }
      );
      // update conversations with the search result
      this.updateUIConversations(searchConversations);
    });
  }

  searchFriends() {
    const searchInput = this.querySelector(
      "input[name='popup-search-players']"
    );
    searchInput.addEventListener("input", (event) => {
      const searchValues = event.target.value.split(' ').filter(Boolean);
      const searchFriends = this.state.friends.filter((friend) => {
        const player = this.choosePlayerFriend(friend);
        const playerName = (player.first_name + ' ' + player.last_name).toLowerCase();
        return searchValues.every(value => playerName.includes(value.toLowerCase()));
      });

      // update friends with the search result
      this.updateUIfriends(searchFriends);
    });
  }

  updateUIConversations(searchConversations = null) {
    const conversationContainer = this.querySelector(
      ".direct_message_container"
    );

    const conversationsToDisplay = searchConversations ? searchConversations : this.state.conversations;

    const conversationElements = conversationsToDisplay.map((conversation) => {
      const conversationElement = this.createConversationElement(conversation);
      return conversationElement;
    });
    conversationContainer.innerHTML = conversationElements.join("");
    this.setConversationsActions();
  }

  createConversationElement(conversation) {
    const conversationParticipant = this.choosePlayerConversation(conversation);
    const unread_messages_count = conversation.unread_messages_count;
    return `
    <button
        class="direct_message_btn border-0 w-100 p-3 rounded-pill d-inline-flex mb-2"
        data-conversation-id="${conversation.conversationID}"
    >
        <div class="avatar me-2">
        <img
            class="avatar_image"
            src="${conversationParticipant.avatar_url}"
            alt="Avatar image"
        />
        <span class="avatar_status ${conversationParticipant.isFriend ? "" : "none"} ${conversationParticipant.online ? "online" : ""}"></span>
        </div>
        <div
        class="flex-grow-1 d-flex flex-column justify-content-between position-relative"
        style="height: 60px"
        >
        <h6 class="text-start m-0">${conversationParticipant.first_name} ${
      conversationParticipant.last_name
    }</h6>
        <p class="direct_message_text text-start m-0">
            ${
              conversation.last_message != null ? conversation.last_message : ""
            }
        </p>
        <span
            class="direct_message_notification_icon position-absolute top-0 end-0 border border-light badge rounded-circle d-flex justify-content-center align-items-center ${
              unread_messages_count > 0 ? "style" : ""
            }"
            >${unread_messages_count > 0 ? unread_messages_count : ""}</span
        >
        </div>
    </button>
    `;
  }

  choosePlayerConversation(conversation) {
    if (conversation.player1.username == app.profile.username) {
      return conversation.player2;
    } else {
      return conversation.player1;
    }
  }

  choosePlayerFriend(friend) {
    if (friend.player1.username == app.profile.username) {
      return friend.player2;
    } else {
      return friend.player1;
    }
  }

  updateOnlineStatusOfFriends(username, is_online) {
    const conversationContainer = this.querySelector(
      ".direct_message_container"
    );
    const conversationButtons = conversationContainer.querySelectorAll(
      ".direct_message_btn"
    );

    const conversation = this.state.conversations.find(
      (conversation) =>
        conversation.player1.username == username ||
        conversation.player2.username == username
    );

    if (conversation) {
      // update the online status of the player in the conversation button
      const conversationBtn = this.querySelector(`button[data-conversation-id='${conversation.conversationID}']`);
      const avatarStatus = conversationBtn.querySelector(".avatar_status");
      avatarStatus.classList.toggle("online", is_online);

      // update the online status of the player in the conversation object
      const player = this.choosePlayerConversation(conversation);
      if (conversation.player1.username == player.username) {
        conversation.player1.online = is_online;
      } else {
        conversation.player2.online = is_online;
      }
    }

    // update the online status of the player in chat message if the conversation is opened
    const chatMessage = this.querySelector("chat-message");
    if (chatMessage && chatMessage._conversation.player.username == username) {
      chatMessage._conversation.player.online = is_online;
      chatMessage.updateOnlineStatus(is_online);
    }

    // update the online status of the player in the popup friends
    const popupFriends = this.querySelector(".popup-friends");
    const popupBtn = popupFriends.querySelector(
      `.popup-btn[data-friend-username='${username}']`
    );
    if (popupBtn) {
      const avatarStatus = popupBtn.querySelector(".avatar_status");
      avatarStatus.classList.toggle("online", is_online);
      // update the online status of the player in the friends list state
      const searchFriends = this.state.friends.find(
        (friend) => friend.player1.username == username || friend.player2.username == username
      );
      if (searchFriends) {
        const player = this.choosePlayerFriend(searchFriends);
        if (searchFriends.player1.username == player.username) {
          searchFriends.player1.online = is_online;
        } else {
          searchFriends.player2.online = is_online;
        }
      }
    }
  }

}

customElements.define("chat-page", ChatPage);
