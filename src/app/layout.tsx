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

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <ColorSchemeScript defaultColorScheme='dark' />     {/** prevent theme flashing (when a dark mode site flickers white for a split second on load) */}
            </head>
            <body className='bg-slate-950 text-slate-50 antialiased'>
                <StoreProvider>
                    <MantineProvider theme={theme} defaultColorScheme='dark'>   {/**Allows all child components to access Mantine's theme variables and styling logic */}
                        {children}
                    </MantineProvider>
                </StoreProvider>
            </body>
        </html>
    )
}