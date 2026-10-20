export async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
export async function sendToPage(message: object) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url))
    throw new Error("Open a website to use this tool.");
  return chrome.tabs.sendMessage(tab.id, message);
}
