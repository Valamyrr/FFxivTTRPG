export function createChatMessage(data) {
  return ChatMessage.create(data, {
    chatBubble: false,
    messageMode: game.settings.get("core", "messageMode"),
  });
}
