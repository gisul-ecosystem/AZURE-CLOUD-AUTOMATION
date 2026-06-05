import './globals.css';

export const metadata = {
  title: 'Azure Access Portal',
  description: 'Provision Azure access requests from a modern Next.js dashboard.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
