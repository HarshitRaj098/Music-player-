import React, { useState, useEffect, useRef } from 'react';
import { Search, Play, Pause, SkipBack, SkipForward, Home, Flame, Radio, Clock, ChevronLeft, ChevronRight, X, Volume2, VolumeX, Cast, ListMusic, Shuffle, Repeat, Repeat1, RotateCcw, RotateCw, ListPlus } from 'lucide-react';
import YouTube, { YouTubeProps, YouTubePlayer } from 'react-youtube';
import { Track } from '../types';

const CATEGORIES = ["Top Hits", "Bollywood", "Pop", "Punjabi", "Lofi", "Romance", "Workout", "Party", "Hip Hop", "Sad", "Podcasts", "Coding"];

const normalizeTitle = (title: string) => {
  return title.toLowerCase()
    .replace(/\[.*?\]|\(.*?\)/g, '') // Remove tags like (Official Video), [Lyric Video]
    .replace(/official video|lyrics|audio|music video/gi, '')
    .replace(/[^a-z0-9]/g, '') // Remove all non-alphanumeric chars
    .trim();
};

export default function MusicPlayer() {
  const [searchQuery, setSearchQuery] = useState('');
  
  // Separation of Search Results vs Playback Queue
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(-1);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState('Top Hits');
  const [viewMode, setViewMode] = useState<'discover' | 'history'>('discover');
  const [history, setHistory] = useState<Track[]>([]);
  const [showNowPlaying, setShowNowPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  const [isMuted, setIsMuted] = useState(false);
  const [repeatMode, setRepeatMode] = useState<0 | 1 | 2>(1); // 0=off, 1=all, 2=one (Default to 1 for continuous play)
  const [toastMsg, setToastMsg] = useState('');
  const toastTimeout = useRef<NodeJS.Timeout | null>(null);

  const playerRef = useRef<YouTubePlayer>(null);
  const queueRef = useRef(queue);
  const repeatModeRef = useRef(repeatMode);
  const isFetchingRadio = useRef(false);
  const wasStalled = useRef(false);
  const lastNextClick = useRef(0);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    repeatModeRef.current = repeatMode;
  }, [repeatMode]);

  const currentTrack = queueIndex >= 0 && queue.length > 0 ? queue[queueIndex] : null;

  useEffect(() => {
    if (currentTrack) {
      setHistory(prev => {
        const filtered = prev.filter(t => t.id !== currentTrack.id);
        return [currentTrack, ...filtered].slice(0, 50);
      });
    }
  }, [currentTrack]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToastMsg(''), 3000);
  };

  // Bulletproof timer and state sync
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!playerRef.current) return;
      try {
        const state = await playerRef.current.getPlayerState();
        if (state === 1) { // 1 = playing
          if (!isPlaying) setIsPlaying(true);
          const currentTime = await playerRef.current.getCurrentTime();
          const duration = await playerRef.current.getDuration();
          if (duration > 0 && duration !== durationSec) setDurationSec(duration);
          if (!isDragging && currentTime !== undefined) {
            setProgress(currentTime);
          }
        } else if (state === 2 || state === 0) { // 2 = paused, 0 = ended
          if (isPlaying) setIsPlaying(false);
        }
      } catch (err) {
        // Player not ready
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isPlaying, isDragging, durationSec]);

  const executeSearch = async (query: string) => {
    if (!query.trim()) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.tracks && data.tracks.length > 0) {
        const parser = new DOMParser();
        const decodedTracks = data.tracks.map((track: Track) => ({
          ...track,
          title: parser.parseFromString(track.title, 'text/html').body.textContent || track.title,
        }));
        
        const unique = [];
        const seen = new Set();
        for (const t of decodedTracks) {
           const norm = normalizeTitle(t.title);
           if (!seen.has(norm)) {
               seen.add(norm);
               unique.push(t);
           }
        }
        
        // Update ONLY search results so current playback is uninterrupted
        setSearchResults(unique);
      } else {
        showToast("No results found");
      }
    } catch (error) {
      console.error('Search error:', error);
      showToast("Error searching YouTube");
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    executeSearch('Latest Top Hit Songs Music Video');
  }, []);

  const handleCategoryClick = (cat: string) => {
    setViewMode('discover');
    setActiveCategory(cat);
    executeSearch(cat + ' hit songs music');
  };

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setViewMode('discover');
      setActiveCategory('');
      executeSearch(searchQuery);
    }
  };

  const handlePlayPause = () => {
    if (!currentTrack && queue.length > 0) {
      setQueueIndex(0);
      setProgress(0);
      setDurationSec(0);
      setIsPlaying(true);
    } else if (currentTrack && playerRef.current) {
      if (isPlaying) {
        playerRef.current.pauseVideo();
      } else {
        playerRef.current.playVideo();
      }
    }
  };

  // Background fetch effect for infinite radio
  useEffect(() => {
    if (queue.length > 0 && queueIndex >= queue.length - 3 && repeatMode === 1 && !isFetchingRadio.current) {
      const fetchMoreRadio = async () => {
        isFetchingRadio.current = true;
        try {
          // Use recent tracks to determine vibe
          const recentTracks = queue.slice(-5);
          const t = recentTracks[Math.floor(Math.random() * recentTracks.length)];
          const cleanTitle = normalizeTitle(t.title).split(' ').slice(0, 4).join(' ');
          
          // YouTube algorithm responds very well to these natural language queries
          const queryTypes = [
            `${t.artist || cleanTitle} top hits`,
            `songs similar to ${cleanTitle} ${t.artist || ''}`,
            `best of ${t.artist || cleanTitle}`,
            `${t.artist || cleanTitle} radio mix`,
            `trending songs like ${cleanTitle}`
          ];
          const query = queryTypes[Math.floor(Math.random() * queryTypes.length)];
          
          const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}`);
          const data = await res.json();
          
          if (data.tracks && data.tracks.length > 0) {
            const parser = new DOMParser();
            const decodedTracks = data.tracks.map((track: Track) => ({
              ...track,
              title: parser.parseFromString(track.title, 'text/html').body.textContent || track.title,
            }));
            
            const recentHistory = queue.slice(-60);
            const recentTitles = new Set(recentHistory.map(track => normalizeTitle(track.title)));
            
            const uniqueNewTracks = [];
            const seenNewTitles = new Set();
            
            for (const track of decodedTracks) {
              const norm = normalizeTitle(track.title);
              // Aggressive deduplication against recent history
              if (!recentHistory.some(q => q.id === track.id) && !recentTitles.has(norm) && !seenNewTitles.has(norm)) {
                seenNewTitles.add(norm);
                uniqueNewTracks.push(track);
              }
            }
            
            let newTracks = uniqueNewTracks;
            if (newTracks.length === 0) {
               newTracks = decodedTracks.slice(0, 10); // Safe fallback
            }
            
            if (newTracks.length > 0) {
              setQueue(prev => [...prev, ...newTracks]);
            }
          }
        } catch (err) {
          console.error('Failed to fetch infinite mix', err);
        } finally {
          isFetchingRadio.current = false;
          if (wasStalled.current) {
            wasStalled.current = false;
            // Check if we actually got new tracks
            setQueueIndex(prev => {
              if (queueRef.current.length > prev + 1) {
                return prev + 1;
              }
              // Fetch failed or no tracks added, loop to 0 to keep music going
              showToast('Restarting radio mix...');
              return 0;
            });
            setIsPlaying(true);
            setProgress(0);
            setDurationSec(0);
          }
        }
      };
      
      fetchMoreRadio();
    }
  }, [queueIndex, queue.length, repeatMode]);

  const handleNext = (autoEnded = false) => {
    if (queueRef.current.length === 0) return;
    
    // Prevent manual spam clicking
    if (!autoEnded) {
      const now = Date.now();
      if (now - lastNextClick.current < 400) {
        return; // Ignore clicks faster than 400ms
      }
      lastNextClick.current = now;
    }
    
    // Repeat One
    if (repeatModeRef.current === 2 && autoEnded) {
      playerRef.current?.seekTo(0);
      playerRef.current?.playVideo();
      setProgress(0);
      return;
    }
    
    // Decoupled state advance
    setQueueIndex(prev => {
      const next = prev + 1;
      const currentQueueLength = queueRef.current.length;
      if (next >= currentQueueLength) {
        if (repeatModeRef.current === 0) {
          if (autoEnded) setIsPlaying(false);
          return prev;
        }
        
        // If we hit the absolute end but we are currently fetching, wait for it instead of looping!
        if (isFetchingRadio.current) {
          showToast('Loading more songs...');
          setIsPlaying(false);
          wasStalled.current = true;
          return prev; // Stay on the last song until fetch finishes
        }

        // If we hit the absolute end and are NOT fetching (e.g. network failure), loop to 0 gracefully
        return 0;
      }
      return next;
    });
    
    setProgress(0);
    setDurationSec(0);
    if (!autoEnded) {
      setIsPlaying(true);
    }
  };

  const handlePrev = () => {
    if (queueRef.current.length === 0) return;
    
    const now = Date.now();
    if (now - lastNextClick.current < 400) {
      return;
    }
    lastNextClick.current = now;

    if (progress > 3 && playerRef.current) {
      playerRef.current.seekTo(0);
      setProgress(0);
    } else {
      setQueueIndex(prev => (prev <= 0 ? queueRef.current.length - 1 : prev - 1));
      setProgress(0);
      setDurationSec(0);
    }
  };

  const toggleShuffle = () => {
    if (queue.length <= 1) return;
    const current = queue[queueIndex];
    const others = queue.filter((_, i) => i !== queueIndex);
    others.sort(() => Math.random() - 0.5);
    setQueue([current, ...others]);
    setQueueIndex(0);
    showToast('Queue Shuffled');
  };

  const toggleMute = () => {
    if (!playerRef.current) return;
    if (isMuted) {
      playerRef.current.unMute();
      setIsMuted(false);
      showToast('Volume Restored');
    } else {
      playerRef.current.mute();
      setIsMuted(true);
      showToast('Muted');
    }
  };

  const toggleRepeat = () => {
    const nextMode = ((repeatMode + 1) % 3) as 0 | 1 | 2;
    setRepeatMode(nextMode);
    showToast(nextMode === 0 ? 'Repeat Off' : nextMode === 1 ? 'Continuous Play (All)' : 'Repeat One');
  };

  const handleTrackSelect = (track: Track, index: number) => {
    if (currentTrack && currentTrack.id === track.id) {
      handlePlayPause();
      return;
    }
    // Replace the queue with current search results and start playing
    setQueue([...searchResults]);
    setQueueIndex(index);
    setProgress(0);
    setDurationSec(0);
    setIsPlaying(true);
  };
  
  const handleAddToQueue = (e: React.MouseEvent, track: Track) => {
    e.stopPropagation();
    setQueue(prev => {
      const newQueue = [...prev, track];
      if (prev.length === 0) {
        setQueueIndex(0);
        setProgress(0);
        setDurationSec(0);
        setIsPlaying(true);
      }
      return newQueue;
    });
    showToast('Added to Queue');
  };

  const handleHistoryTrackSelect = (track: Track) => {
    if (currentTrack && currentTrack.id === track.id) {
      handlePlayPause();
      return;
    }
    // Replace the queue with history and start playing
    setQueue([...history]);
    const index = history.findIndex(t => t.id === track.id);
    setQueueIndex(index);
    setProgress(0);
    setDurationSec(0);
    setIsPlaying(true);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!currentTrack || durationSec === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * durationSec;
    setProgress(newTime);
    if (playerRef.current) {
      playerRef.current.seekTo(newTime);
    }
  };

  const formatTime = (seconds: number) => {
    if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const onPlayerReady: YouTubeProps['onReady'] = (event) => {
    playerRef.current = event.target;
    if (isPlaying) event.target.playVideo();
    if (isMuted) event.target.mute();
  };

  const onPlayerStateChange: YouTubeProps['onStateChange'] = (event) => {
    if (event.data === 1) setIsPlaying(true);
    else if (event.data === 2) setIsPlaying(false);
    else if (event.data === 0) handleNext(true);
  };

  return (
    <div className="h-full w-full bg-slate-900 flex flex-col font-sans overflow-hidden relative">
      
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur-xl border border-white/20 text-white px-6 py-2.5 rounded-full z-[200] text-sm font-medium animate-in fade-in slide-in-from-top-4 shadow-2xl">
          {toastMsg}
        </div>
      )}

      {/* Hidden YouTube Player */}
      <div className="hidden">
        {currentTrack && (
          <YouTube
            videoId={currentTrack.id}
            opts={{
              height: '0',
              width: '0',
              playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1, rel: 0, playsinline: 1 },
            }}
            onReady={onPlayerReady}
            onStateChange={onPlayerStateChange}
            onError={() => handleNext(true)}
          />
        )}
      </div>

      {/* Top Categories Pill Navigation */}
      <div className="flex items-center gap-3 px-6 py-4 overflow-x-auto custom-scrollbar shrink-0 border-b border-white/5 bg-slate-900/95 backdrop-blur z-10">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => handleCategoryClick(cat)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              activeCategory === cat ? 'bg-white text-slate-900' : 'bg-white/10 hover:bg-white/20 text-white/90'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Main Content Scrollable Area */}
      <div className="flex-1 overflow-y-auto px-6 py-6 pb-48 custom-scrollbar">
        
        {/* Top Controls & Search */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex gap-4 items-center w-full max-w-2xl">
            <div className="flex gap-2 shrink-0">
              <button onClick={() => showToast('Back navigation coming soon')} className="w-8 h-8 rounded-full bg-black/40 flex items-center justify-center hover:bg-black/60 transition-colors">
                <ChevronLeft size={20} className="text-white/70" />
              </button>
              <button onClick={() => showToast('Forward navigation coming soon')} className="w-8 h-8 rounded-full bg-black/40 flex items-center justify-center hover:bg-black/60 transition-colors">
                <ChevronRight size={20} className="text-white/70" />
              </button>
            </div>
            
            <form onSubmit={handleManualSearch} className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" size={18} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search songs, artists, podcasts..."
                className="w-full bg-white/5 border border-transparent rounded-full py-2.5 pl-12 pr-4 text-sm text-white outline-none focus:border-white/20 focus:bg-white/10 transition-all placeholder:text-white/40"
              />
            </form>
          </div>
        </div>

        {viewMode === 'discover' ? (
          <>
            <h2 className="text-3xl font-bold mb-6 text-white tracking-tight">Quick Picks</h2>

            {isLoading ? (
              <div className="flex justify-center py-20">
                <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin"></div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-3">
                {searchResults.map((track, index) => {
                  const isActive = currentTrack?.id === track.id;
                  return (
                    <div
                      key={track.id + index}
                      onClick={() => handleTrackSelect(track, index)}
                      className="flex items-center p-2 rounded-md group cursor-pointer transition-colors hover:bg-white/5"
                    >
                      <div className="relative w-[48px] h-[48px] rounded overflow-hidden shrink-0">
                        <img src={track.albumArt} alt={track.title} className="w-full h-full object-cover" />
                        {isActive && isPlaying && (
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                            <div className="flex gap-[2px] items-end h-3">
                              <div className="w-[3px] bg-white animate-[bounce_1s_infinite_0.1s]"></div>
                              <div className="w-[3px] bg-white animate-[bounce_1s_infinite_0.3s]"></div>
                              <div className="w-[3px] bg-white animate-[bounce_1s_infinite_0.2s]"></div>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="ml-3 flex-1 min-w-0 pr-4">
                        <div className={`truncate text-sm font-medium ${isActive ? 'text-white' : 'text-white/90 group-hover:text-white'}`}>
                          {track.title}
                        </div>
                        <div className="truncate text-xs text-slate-400 mt-0.5">
                          {track.artist}
                        </div>
                      </div>
                      
                      {/* Add to Queue Button */}
                      <button
                        onClick={(e) => handleAddToQueue(e, track)}
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 bg-white/5 text-white/70 hover:bg-white/20 hover:text-white transition-all mr-2"
                        title="Add to Queue"
                      >
                        <ListPlus size={16} />
                      </button>
                      
                      {/* Play/Pause indicator */}
                      <button className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all ${isActive ? 'opacity-100 bg-white/10 text-white' : 'opacity-0 group-hover:opacity-100 bg-white/5 text-white hover:bg-white/20'}`}>
                        {isActive && isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <h2 className="text-3xl font-bold mb-6 text-white tracking-tight">Listening History</h2>
            {history.length === 0 ? (
              <div className="text-center py-20 text-white/50">
                <Clock size={48} className="mx-auto mb-4 opacity-50" />
                <p>No listening history yet.</p>
                <p className="text-sm mt-1">Songs you play will appear here.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-3">
                {history.map((track, index) => {
                  const isActive = currentTrack?.id === track.id;
                  return (
                    <div
                      key={track.id + index}
                      onClick={() => handleHistoryTrackSelect(track)}
                      className="flex items-center p-2 rounded-md group cursor-pointer transition-colors hover:bg-white/5"
                    >
                      <div className="relative w-[48px] h-[48px] rounded overflow-hidden shrink-0">
                        <img src={track.albumArt} alt={track.title} className="w-full h-full object-cover" />
                        {isActive && isPlaying && (
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                            <div className="flex gap-[2px] items-end h-3">
                              <div className="w-[3px] bg-white animate-[bounce_1s_infinite_0.1s]"></div>
                              <div className="w-[3px] bg-white animate-[bounce_1s_infinite_0.3s]"></div>
                              <div className="w-[3px] bg-white animate-[bounce_1s_infinite_0.2s]"></div>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="ml-3 flex-1 min-w-0 pr-4">
                        <div className={`truncate text-sm font-medium ${isActive ? 'text-white' : 'text-white/90 group-hover:text-white'}`}>
                          {track.title}
                        </div>
                        <div className="truncate text-xs text-slate-400 mt-0.5">
                          {track.artist}
                        </div>
                      </div>
                      
                      {/* Add to Queue Button */}
                      <button
                        onClick={(e) => handleAddToQueue(e, track)}
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 bg-white/5 text-white/70 hover:bg-white/20 hover:text-white transition-all mr-2"
                        title="Add to Queue"
                      >
                        <ListPlus size={16} />
                      </button>
                      
                      {/* Play/Pause indicator */}
                      <button className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all ${isActive ? 'opacity-100 bg-white/10 text-white' : 'opacity-0 group-hover:opacity-100 bg-white/5 text-white hover:bg-white/20'}`}>
                        {isActive && isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom Floating Player Bar */}
      {currentTrack && (
        <div className="fixed bottom-[64px] left-2 right-2 md:left-4 md:right-4 h-[72px] bg-gradient-to-r from-rose-950/90 to-slate-900/90 backdrop-blur-md rounded-lg flex items-center px-4 justify-between shadow-2xl z-20 border border-white/10">
          
          {/* Progress Bar (Absolute top edge of player) */}
          <div 
            className="absolute top-0 left-0 w-full h-[3px] bg-white/10 cursor-pointer rounded-t-lg overflow-hidden group"
            onClick={handleProgressClick}
          >
            <div 
              className="h-full bg-rose-500 relative transition-all group-hover:bg-rose-400" 
              style={{ width: `${durationSec > 0 ? (progress / durationSec) * 100 : 0}%` }}
            />
          </div>

          <div className="flex items-center gap-4 w-1/3 min-w-0 cursor-pointer rounded-lg p-1 hover:bg-white/5 transition-colors" onClick={() => setShowNowPlaying(true)}>
            <img src={currentTrack.albumArt} alt={currentTrack.title} className="w-12 h-12 rounded object-cover shadow-md" />
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold truncate text-white">{currentTrack.title}</h4>
              <p className="text-xs text-white/60 truncate mt-0.5">{currentTrack.artist}</p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-6 w-1/3">
            <button onClick={handlePrev} className="text-white/60 hover:text-white transition-colors">
              <SkipBack size={20} fill="currentColor" />
            </button>
            <button 
              onClick={handlePlayPause} 
              className="w-12 h-12 rounded-full bg-white text-slate-900 flex items-center justify-center hover:scale-105 transition-transform shadow-lg"
            >
              {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-1" />}
            </button>
            <button onClick={handleNext} className="text-white/60 hover:text-white transition-colors">
              <SkipForward size={20} fill="currentColor" />
            </button>
          </div>

          <div className="w-1/3 flex justify-end gap-6 items-center">
            <button onClick={toggleMute} className="text-white/60 hover:text-white transition-colors hidden sm:block">
               {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <div className="text-[11px] font-medium tracking-wider text-white/40">
              {formatTime(progress)} / {durationSec > 0 ? formatTime(durationSec) : '0:00'}
            </div>
          </div>
        </div>
      )}

      {/* Now Playing Fullscreen Overlay */}
      {showNowPlaying && currentTrack && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-slate-900 text-white animate-in fade-in zoom-in-95 duration-200">
          {/* Dynamic Glass Background */}
          <div 
            className="absolute inset-0 bg-cover bg-center opacity-40 blur-[100px] scale-150 transform-gpu pointer-events-none"
            style={{ backgroundImage: `url(${currentTrack.albumArt.replace('default.jpg', 'hqdefault.jpg')})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-slate-900/80 to-slate-900 pointer-events-none" />

          {/* Top Bar */}
          <div className="relative z-10 flex items-center justify-between px-6 py-4 shrink-0">
            <div className="flex items-center gap-4">
              <button onClick={() => setShowNowPlaying(false)} className="text-white/70 hover:text-white transition-colors">
                <X size={24} />
              </button>
              <span className="font-semibold tracking-wide">Now Playing</span>
            </div>
            <div className="flex items-center gap-4 md:gap-6 text-white/70">
              <button onClick={toggleMute} className="hover:text-white transition-colors">
                 {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
              <button onClick={() => showToast("Casting devices not found")} className="hover:text-white transition-colors hidden sm:block"><Cast size={20} /></button>
              <button onClick={() => setShowNowPlaying(false)} className="hover:text-white transition-colors"><ListMusic size={20} /></button>
            </div>
          </div>

          {/* Main Content */}
          <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 md:px-6 py-4 overflow-y-auto custom-scrollbar min-h-0">
            {/* Album Art / Thumbnail */}
            <div className="w-full max-w-[700px] max-h-[40vh] md:max-h-[50vh] aspect-video shrink-0 rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 bg-black/50 flex items-center justify-center mt-auto">
              <img 
                src={currentTrack.albumArt.replace('default.jpg', 'hqdefault.jpg').replace('mqdefault.jpg', 'hqdefault.jpg')} 
                alt={currentTrack.title}
                className="w-full h-full object-contain"
              />
            </div>

            {/* Track Info */}
            <div className="mt-6 md:mt-10 text-center w-full max-w-2xl px-4 shrink-0">
              <h2 className="text-xl md:text-3xl font-bold text-white truncate mb-1 md:mb-2">{currentTrack.title}</h2>
              <p className="text-base md:text-lg text-white/60 truncate">{currentTrack.artist}</p>
            </div>

            {/* Progress Bar & Times */}
            <div className="mt-6 md:mt-8 w-full max-w-3xl px-4 flex flex-col shrink-0">
              <input
                type="range"
                min="0"
                max={durationSec > 0 ? durationSec : 100}
                value={progress}
                onMouseDown={() => setIsDragging(true)}
                onTouchStart={() => setIsDragging(true)}
                onMouseUp={(e) => {
                  setIsDragging(false);
                  if (playerRef.current) playerRef.current.seekTo(Number(e.currentTarget.value));
                }}
                onTouchEnd={(e) => {
                  setIsDragging(false);
                  if (playerRef.current) playerRef.current.seekTo(Number(e.currentTarget.value));
                }}
                onChange={(e) => setProgress(Number(e.target.value))}
                disabled={!currentTrack || durationSec === 0}
                className="w-full h-1.5 appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer cursor-pointer disabled:cursor-not-allowed shadow-sm"
                style={{
                  background: currentTrack && durationSec > 0
                    ? `linear-gradient(to right, #ffffff ${(progress / durationSec) * 100}%, rgba(255,255,255,0.2) ${(progress / durationSec) * 100}%)`
                    : 'rgba(255,255,255,0.2)'
                }}
              />
              <div className="flex justify-between items-center text-sm font-medium text-white/50 mt-3">
                <span>{formatTime(progress)}</span>
                <span>{durationSec > 0 ? formatTime(durationSec) : '0:00'}</span>
              </div>
            </div>

            {/* Controls */}
            <div className="mt-6 md:mt-8 flex items-center justify-center gap-6 md:gap-8 w-full max-w-2xl px-4 shrink-0 mb-auto">
              <button onClick={toggleShuffle} className="text-white/50 hover:text-white transition-colors hidden sm:block"><Shuffle size={20} /></button>
              <button onClick={handlePrev} className="text-white hover:text-white/80 transition-colors"><SkipBack size={24} fill="currentColor" /></button>
              <button onClick={() => {
                const target = Math.max(0, progress - 10);
                setProgress(target);
                playerRef.current?.seekTo(target);
              }} className="text-white/70 hover:text-white transition-colors relative flex items-center justify-center">
                <RotateCcw size={22} />
                <span className="absolute text-[9px] font-bold mt-0.5">10</span>
              </button>
              
              <button 
                onClick={handlePlayPause}
                className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-white text-slate-900 flex items-center justify-center hover:scale-105 transition-transform shadow-xl shrink-0"
              >
                {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1.5" />}
              </button>
              
              <button onClick={() => {
                const target = Math.min(durationSec, progress + 10);
                setProgress(target);
                playerRef.current?.seekTo(target);
              }} className="text-white/70 hover:text-white transition-colors relative flex items-center justify-center">
                <RotateCw size={22} />
                <span className="absolute text-[9px] font-bold mt-0.5">10</span>
              </button>
              <button onClick={handleNext} className="text-white hover:text-white/80 transition-colors"><SkipForward size={24} fill="currentColor" /></button>
              <button onClick={toggleRepeat} className={`transition-colors hidden sm:block ${repeatMode !== 0 ? 'text-rose-400' : 'text-white/50 hover:text-white'}`}>
                {repeatMode === 2 ? <Repeat1 size={20} /> : <Repeat size={20} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Global Navigation */}
      <div className="fixed bottom-0 left-0 right-0 h-16 bg-slate-900/95 backdrop-blur-md border-t border-white/5 flex items-center justify-around z-30 px-2 md:px-20">
        <button onClick={() => { setViewMode('discover'); setActiveCategory('Top Hits'); executeSearch('Top Hits 2026 music'); }} className={`flex flex-col items-center justify-center w-16 h-full transition-colors ${viewMode === 'discover' && activeCategory === 'Top Hits' ? 'text-white' : 'text-white/50 hover:text-white'}`}>
          <Home size={22} />
          <span className="text-[10px] mt-1 font-medium">Home</span>
        </button>
        <button onClick={() => { setViewMode('discover'); setActiveCategory(''); executeSearch('Trending new hit music releases'); showToast('Exploring trending music'); }} className={`flex flex-col items-center justify-center w-16 h-full transition-colors ${viewMode === 'discover' && activeCategory === '' && searchQuery === '' ? 'text-white' : 'text-white/50 hover:text-white'}`}>
          <Flame size={22} />
          <span className="text-[10px] mt-1 font-medium">Explore</span>
        </button>
        <button onClick={() => { setViewMode('discover'); document.querySelector('input')?.focus() }} className="flex flex-col items-center justify-center w-16 h-full text-white/50 hover:text-white transition-colors">
          <Search size={22} />
          <span className="text-[10px] mt-1 font-medium">Search</span>
        </button>
        <button onClick={() => showToast('Library syncing coming soon')} className="flex flex-col items-center justify-center w-16 h-full text-white/50 hover:text-white transition-colors">
          <Radio size={22} />
          <span className="text-[10px] mt-1 font-medium">Library</span>
        </button>
        <button onClick={() => { setViewMode('history'); setActiveCategory(''); }} className={`flex flex-col items-center justify-center w-16 h-full transition-colors ${viewMode === 'history' ? 'text-white' : 'text-white/50 hover:text-white'}`}>
          <Clock size={22} />
          <span className="text-[10px] mt-1 font-medium">History</span>
        </button>
      </div>
      
    </div>
  );
}
