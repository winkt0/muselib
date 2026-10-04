import { browser } from "wxt/browser";

const FOCUS_REQUEST = "library-page/focus";

/**
 * Opens the library page in a tab, or switches to it if it's already open.
 *
 * Without the "tabs" permission (which shows a "Read your browsing history"
 * warning on install) tabs.query() returns no URLs, not even for the
 * extension's own pages. So instead of searching tabs, we ask any open
 * library page to bring itself to the front, and only open a new tab if
 * none answers.
 */
export async function openLibraryTab(): Promise<void> {
    const focused = await browser.runtime.sendMessage({ type: FOCUS_REQUEST }).catch(() => false);
    if (focused === true) return;
    await browser.tabs.create({ url: browser.runtime.getURL("/library.html") });
}

/** Call from the library page so openLibraryTab() can find it. Returns a cleanup function. */
export function listenForLibraryFocusRequests(): () => void {
    const listener = (msg: unknown, _sender: unknown, sendResponse: (focused: boolean) => void) => {
        if ((msg as { type?: unknown } | null)?.type !== FOCUS_REQUEST) return undefined;
        browser.tabs
            .getCurrent()
            .then(async tab => {
                if (tab?.id === undefined) return sendResponse(false);
                await browser.tabs.update(tab.id, { active: true });
                if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
                sendResponse(true);
            })
            .catch(() => sendResponse(false));
        return true; // respond asynchronously
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
}
