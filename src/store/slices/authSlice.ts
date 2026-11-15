import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type AuthStatus =
    | "BOOTSTRAPPING"
    | "VERIFYING"
    | "AUTHENTICATED"
    | "UNAUTHENTICATED"
    | "UNAVAILABLE";

interface AuthState {
    token: string | null;
    isAuthenticated: boolean;
    username: string | null;
    userId: string | null;
    isAuthHydrated: boolean;
    status: AuthStatus;
}

const initialState: AuthState = {
    token: null,
    userId: null,
    username: null,
    isAuthenticated: false,
    isAuthHydrated: false,
    status: "BOOTSTRAPPING",
};

// Creates the actual slice - contianer for the state logic
export const authSlice = createSlice({
    // The `name` acts as a prefix for the generated action types (e.g., auth/setCredentials)
    name: "auth",
    initialState,

    // A collection of functions that determine how the state changes
    // Redux Toolkit uses a library called `Immer`, which allows to write "mutating" code like `state.x = y`
    // safely turned into an immutable update behind the scenes
    reducers: {
        // The login logic
        // Takes the `token` from  the ation's payload, saves it to the state, and
        // flips the `isAuthenticated` switch to `true`

        // It updates the state to:
        // `{
        //      token: "abc...123",
        //      isAuthenticated: true
        //  }`
        setCredentials: (state, action: PayloadAction<{ token: string }>) => {
            state.token = action.payload.token;
            state.isAuthenticated = false;
            state.status = "VERIFYING";
        },

        setProfileData: (
            state,
            action: PayloadAction<{ userId: string; username: string }>,
        ) => {
            state.userId = action.payload.userId;
            state.username = action.payload.username;
            state.isAuthenticated = true;
            state.status = "AUTHENTICATED";
        },

        setAuthHydrated: (state) => {
            state.isAuthHydrated = true;
            if (!state.token) {
                state.status = "UNAUTHENTICATED";
            }
        },

        setAuthUnavailable: (state) => {
            if (state.token) {
                state.status = "UNAVAILABLE";
            }
        },

        // The logout logic
        // It wipes the token and sets the state to `false`
        // Resets the state to: `{ token: null, isAuthenticated: false }`
        clearCredentials: (state) => {
            state.userId = null;
            state.token = null;
            state.isAuthenticated = false;
            state.username = null;
            state.status = "UNAUTHENTICATED";
        },
    },
});

// Destructuring and exporting the action creators
// They can be called: `dispatch(setCredentials({ token: '...' }))` from the login page

// Returns functions that create action object like:
// `{
//      type: "auth/setCredentials",
//      payload: {
//          token: "...",
//      }
//  }`
export const {
    setCredentials,
    clearCredentials,
    setProfileData,
    setAuthHydrated,
    setAuthUnavailable,
} = authSlice.actions;

// The main reducer function
// This need to be imported into `store.ts` file so the Redux  store knows how to handle auth-related changes.

// It returns a single function that processes all state changes for this slice
export default authSlice.reducer;
