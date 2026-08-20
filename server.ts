import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Search YouTube API route
  app.get('/api/youtube/search', async (req, res) => {
    try {
      const query = req.query.q as string;
      const apiKey = process.env.YOUTUBE_API_KEY;

      if (!apiKey) {
         res.status(500).json({ error: 'YOUTUBE_API_KEY is not configured.' });
         return;
      }
      if (!query) {
         res.status(400).json({ error: 'Missing search query.' });
         return;
      }

      // We only request snippet (title, channel, thumbnails)
      const ytRes = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=50&q=${encodeURIComponent(query)}&key=${apiKey}`
      );
      const data = await ytRes.json();

      if (data.error) {
        console.error('YouTube API Error:', data.error);
        res.status(500).json({ error: 'YouTube API Error', details: data.error.message });
        return;
      }

      const tracks = data.items.map((item: any) => ({
        id: item.id.videoId,
        title: item.snippet.title,
        artist: item.snippet.channelTitle,
        duration: '', // We don't get duration from search snippet, could do another fetch but let's keep it simple
        durationSec: 0,
        albumArt: item.snippet.thumbnails.default?.url || item.snippet.thumbnails.medium?.url || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=150&h=150&fit=crop&q=80',
      }));

      res.json({ tracks });
    } catch (error) {
      console.error('Error fetching YouTube data:', error);
      res.status(500).json({ error: 'Failed to fetch from YouTube API' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
