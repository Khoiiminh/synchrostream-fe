"use client";

import { useState, useSyncExternalStore, type CSSProperties } from "react";
import {
    ActionIcon,
    PasswordInput,
    TextInput,
    type PasswordInputProps,
    type TextInputProps,
} from "@mantine/core";
import { Eye, EyeOff } from "lucide-react";

/**
 * Input for a watch-room password.
 *
 * Why not Mantine's PasswordInput: browsers treat every `type="password"`
 * field as a site login. On the create and join forms Chrome offered to
 * generate a password, autofilled the user's real account credentials into the
 * room code and password, and after joining offered to save the room code and
 * password as this site's login, overwriting or shadowing the user's real
 * saved credentials. Chrome ignores `autocomplete="off"` on password fields,
 * so the field must not be a password field at all.
 *
 * This renders a text input masked with `-webkit-text-security` (Chromium,
 * Safari and Firefox support it). Password managers see an ordinary text box:
 * no suggestion, no autofill, no "Save password?". The few browsers that cannot
 * mask a text input get a real password field instead, so a room password is
 * never shown in plain text by accident.
 */
export type RoomPasswordInputProps = Omit<TextInputProps, "type"> & {
    "data-autofocus"?: boolean;
};

/** Attributes common password managers read as "never offer anything here". */
const PASSWORD_MANAGER_OPT_OUT = {
    "data-1p-ignore": "true",
    "data-lpignore": "true",
    "data-bwignore": "true",
    "data-form-type": "other",
} as const;

/** Browser support never changes during a page's life: nothing to subscribe to. */
const noSubscription = () => () => {};

function canMaskTextInput(): boolean {
    return (
        typeof CSS !== "undefined" &&
        typeof CSS.supports === "function" &&
        CSS.supports("-webkit-text-security", "disc")
    );
}

export function RoomPasswordInput(props: RoomPasswordInputProps) {
    const [visible, setVisible] = useState(false);
    // The server render assumes masking works (all current major browsers);
    // the client reads the real support.
    const maskable = useSyncExternalStore(
        noSubscription,
        canMaskTextInput,
        () => true,
    );

    if (!maskable) {
        // Callers pass only props the two inputs share (label, value, icons…).
        return (
            <PasswordInput
                {...(props as PasswordInputProps)}
                autoComplete="new-password"
            />
        );
    }

    const { styles, ...rest } = props;
    const callerInputStyle =
        typeof styles === "object" && styles && "input" in styles
            ? (styles.input as CSSProperties)
            : undefined;

    return (
        <TextInput
            {...rest}
            {...PASSWORD_MANAGER_OPT_OUT}
            type="text"
            // Not "password", "pass" or "pwd": some managers match on names.
            name="room-secret"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            styles={{
                ...(typeof styles === "object" ? styles : {}),
                input: {
                    ...callerInputStyle,
                    WebkitTextSecurity: visible ? "none" : "disc",
                } as CSSProperties,
            }}
            rightSection={
                <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    onClick={() => setVisible((v) => !v)}
                    // Keep the caret in the input, like Mantine's own toggle.
                    onMouseDown={(event) => event.preventDefault()}
                    aria-label={visible ? "Hide password" : "Show password"}
                    aria-pressed={visible}
                    tabIndex={-1}
                >
                    {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                </ActionIcon>
            }
        />
    );
}
