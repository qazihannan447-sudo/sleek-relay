const sections: string[] = [
  'Minimal Next.js portal shell',
  'Health endpoint for local verification',
  'No product features or provider integrations yet',
];

export default function HomePage() {
  return (
    <main
      style={{ fontFamily: 'sans-serif', padding: '2rem', lineHeight: 1.5 }}
    >
      <h1>Sleek Relay Validation Demo</h1>
      <p>
        This is the initial project foundation for the browser-based demo. The
        portal currently exposes only a simple UI shell and a health endpoint.
      </p>
      <ul>
        {sections.map((section) => (
          <li key={section}>{section}</li>
        ))}
      </ul>
      <p>
        Health check: <code>/api/health</code>
      </p>
    </main>
  );
}
