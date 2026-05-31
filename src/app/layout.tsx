import '@mantine/core/styles.css';
import './globals.css';
import { ColorSchemeScript, MantineProvider, createTheme } from '@mantine/core';
import { StoreProvider } from '@/store/StoreProvider';

/**
 * TAILWIND & MANTINE INTEGRATION CONFIGURATION
 *      To ensure Tailwind CSS utility properties work seamlessly alongside Mantine's pre-built CSS 
 * enginestyles without style collision.
 */

const theme = createTheme({
    primaryColor: 'violet',
    fontFamily: 'Inter, sans-serif',
});

export const metadata = {
    title: 'SynchroStream - Synchronized Collaborative Film Platform',
    description: 'Watch content in absolute real-time synchronization with peers.', 
}

/** This is what is happening "under the hood"
    StoreProvider({ 
        children: MantineProvider({ 
            theme: theme, 
            children: PageContent 
        }) 
    }); 
*/

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head><ColorSchemeScript defaultColorScheme='dark' /></head>    
            <body className='bg-slate-950 text-slate-50 antialiased' suppressHydrationWarning={true}>
                <StoreProvider>   {/**The `children` being passed into `StoreProvider` is the entire`MantineProvider` and everything inside it */}
                    <MantineProvider theme={theme} defaultColorScheme='dark'>   {/**Allows all child components to access Mantine's theme variables and styling logic */}
                        {children}
                    </MantineProvider>
                </StoreProvider>
            </body>
        </html>
    )
}