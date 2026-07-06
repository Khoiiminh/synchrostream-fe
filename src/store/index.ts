import { configureStore } from "@reduxjs/toolkit";
import { authApi } from "./services/authApi";
import authReducer from '@/store/slices/authSlice';
import ingestionReducer from '@/store/slices/ingestionSlice';
import playbackReducer from '@/store/slices/playbackSlice'
import { adminMediaApi } from "./services/adminMediaApi";
import { mediaApi } from "./services/mediaApi";
import roomReducer from "@/store/slices/roomSlice";
import { watchPartyApi } from "./services/watchPartyApi";

/**
 * CENTRAL REDUX SETUP
 */

// The actual initialization of the global Redux Store
// It takes all separate slices and APIs and merges them into a single state tree
export const store = configureStore({

    // A map of the different "departments" of the state
    reducer: {
        auth: authReducer,  // handles the local state (the token and login status from `authSlice`)

        ingestion: ingestionReducer,

        playback: playbackReducer,

        room: roomReducer,

        // Dynamically adds the RTK Query cache management logic
        // It returns: A combined state object like:
        // { 
        //      auth: { 
        //          token: null... 
        //      }, 
        //      authApi: { 
        //          queries: {}, 
        //          mutations: {}... 
        //      } 
        //  }
        [authApi.reducerPath]: authApi.reducer, // Using [authApi.reducerPath] ensures the key in the store matches the reducerPath ("authApi") that is defined in your API file.
        [adminMediaApi.reducerPath]: adminMediaApi.reducer,
        [mediaApi.reducerPath]: mediaApi.reducer,
        [watchPartyApi.reducerPath]: watchPartyApi.reducer,
    },

    // A "pipeline" that actions pass through before hitting the store
    // RTK Query requires its specific middleware to handle things like caching, invalidating data, and polling
    // It takes the standard Redux middleware (which handles things like logs or async calls) and 
    // "tacks on" the `authApi` logic at the end.
    middleware: (getDefaultMiddleware) => 
        getDefaultMiddleware({ 
            serializableCheck: false    // Prevents errors with fast engine-to-store snapshot synchronization
        }).concat(authApi.middleware, adminMediaApi.middleware, mediaApi.middleware, watchPartyApi.middleware),    // Only API services append middleware here
});

// A dynamic TypeScript type representing the entire state of the store
// Instead of manually writing a type for every piece of data in the store, 
// this automatically updates whenevera new reducer is added
// It returns: A type definition used by `useAppSelector` hook
export type RootState = ReturnType<typeof store.getState>;

// The type of the store's "dispatch" function
// It allows `useAppDispatch` hook to know exactly which actions (including complex API actions) are valid to send to the store
export type AppDispatch = typeof store.dispatch;