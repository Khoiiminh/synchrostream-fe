"use client";

import { useEffect, useRef } from "react";

/**
 * Voluntary-leave navigation guard for the party page.
 *
 * Leaving a watch room on purpose must clean up immediately (no 10 s
 * reconnection grace), so any in-app navigation away from an active party is
 * routed through the page's leave flow (confirm for owners → leave → navigate).
 *
 * Covered:
 *  - <Link>/<a> clicks to another same-origin path (document capture listener)
 *  - browser Back (history sentinel + popstate)
 *  - programmatic navigation from shared UI via `guardedNavigate()`
 *
 * Deliberately NOT covered: tab close and refresh. The browser fires the same
 * `beforeunload` for both, and a refresh must keep the user in the room, so
 * those stay on the server's connection-loss (grace) path.
 */

/** Where the user was heading when the guard intercepted navigation. */
export type LeaveDestination =
    | { kind: "href"; href: string }
    | { kind: "back" };

type LeaveGuardHandler = (destination: LeaveDestination) => void;

let activeGuard: LeaveGuardHandler | null = null;

interface RouterLike {
    push: (href: string) => void;
}

/**
 * Use instead of `router.push` in UI shared with the party page (navbar,
 * profile menu): when a party is active it runs the leave flow first.
 */
export function guardedNavigate(router: RouterLike, href: string): void {
    if (activeGuard) {
        activeGuard({ kind: "href", href });
        return;
    }
    router.push(href);
}

const SENTINEL_KEY = "synchroStreamLeaveGuard";

/**
 * Installs the guard while `enabled`. `onLeaveAttempt` receives the intended
 * destination; it decides whether to confirm, performs the leave, and then
 * navigates (use `completeBackNavigation()` for a "back" destination).
 */
export function usePartyLeaveGuard(
    enabled: boolean,
    onLeaveAttempt: LeaveGuardHandler,
): void {
    const handlerRef = useRef(onLeaveAttempt);
    useEffect(() => {
        handlerRef.current = onLeaveAttempt;
    }, [onLeaveAttempt]);

    useEffect(() => {
        if (!enabled || typeof window === "undefined") return;

        const handler: LeaveGuardHandler = (destination) =>
            handlerRef.current(destination);
        activeGuard = handler;

        const onClick = (event: MouseEvent) => {
            if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
            ) {
                return;
            }
            const anchor = (event.target as Element | null)?.closest?.(
                "a[href]",
            ) as HTMLAnchorElement | null;
            if (
                !anchor ||
                anchor.target === "_blank" ||
                anchor.hasAttribute("download")
            )
                return;

            const url = new URL(anchor.href, window.location.href);
            // External sites unload the page: that is the ambiguous (grace) path.
            if (url.origin !== window.location.origin) return;
            if (url.pathname === window.location.pathname) return;

            // Capture phase on document runs before React's root listener, so the
            // Next <Link> handler never starts its own navigation.
            event.preventDefault();
            event.stopPropagation();
            handler({
                kind: "href",
                href: `${url.pathname}${url.search}${url.hash}`,
            });
        };

        // A sentinel entry above the party entry turns the first Back press into a
        // popstate we can intercept, instead of an immediate navigation.
        const currentState = (window.history.state ?? {}) as Record<
            string,
            unknown
        >;
        if (!currentState[SENTINEL_KEY]) {
            window.history.pushState(
                { ...currentState, [SENTINEL_KEY]: true },
                "",
                window.location.href,
            );
        }

        const onPopState = (event: PopStateEvent) => {
            const state = (event.state ?? {}) as Record<string, unknown>;
            if (state[SENTINEL_KEY]) return;
            // Back was pressed: restore the sentinel (stay on the page) and ask.
            window.history.pushState(
                { ...state, [SENTINEL_KEY]: true },
                "",
                window.location.href,
            );
            handler({ kind: "back" });
        };

        document.addEventListener("click", onClick, true);
        window.addEventListener("popstate", onPopState);

        return () => {
            if (activeGuard === handler) activeGuard = null;
            document.removeEventListener("click", onClick, true);
            window.removeEventListener("popstate", onPopState);
        };
    }, [enabled]);
}

/**
 * Completes a Back navigation after the leave: steps over the sentinel and the
 * party entry to the page the user came from.
 */
export function completeBackNavigation(): void {
    window.history.go(-2);
}
