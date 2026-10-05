/**
 * MyDM Content Script - Smart Resource & Media Detector
 * Inspects DOM and media elements on active pages to discover downloadable assets.
 * Supports modern SPAs (Instagram, YouTube, TikTok, Twitter/X, Facebook, etc.),
 * high-resolution srcset parsing, lazy loading, and direct video detection.
 */

(function () {
  'use strict';

  // Prevent multiple executions in the same frame
  if (window.__mydm_content_injected) {
    return;
  }
  window.__mydm_content_injected = true;

  const KNOWN_IMAGE_CDNS = [
    'cdninstagram.com', 'fbcdn.net', 'twimg.com', 'ytimg.com',
    'pinimg.com', 'imgur.com', 'cloudinary.com', 'unsplash.com',
    'wp.com', 'googleusercontent.com', 'cloudfront.net', 'media.tumblr.com',
    'flickr.com', 'staticflickr.com', 'redd.it', 'tiktokcdn.com'
  ];

  const DOWNLOADABLE_EXTENSIONS = {
    // Videos
    mp4: 'video', mkv: 'video', webm: 'video', avi: 'video', mov: 'video', flv: 'video', wmv: 'video',
    // Audio
    mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio', opus: 'audio',
    // Streaming Manifests
    m3u8: 'video', mpd: 'video',
    // Images
    jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image', svg: 'image', avif: 'image', bmp: 'image',
    // Documents
    pdf: 'document', epub: 'document', doc: 'document', docx: 'document', xls: 'document',
    xlsx: 'document', ppt: 'document', pptx: 'document', csv: 'document', txt: 'document',
    // Archives & ISOs
    zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
    bz2: 'archive', xz: 'archive', iso: 'archive', dmg: 'archive',
    // Executables
    exe: 'program', msi: 'program', pkg: 'program', deb: 'program', rpm: 'program', apk: 'program'
  };

  /**
   * Check if a URL directly represents a single video/media resource rather than a collection/feed.
   */
  function isDirectVideoUrl(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url, window.location.href);
      let host = parsed.hostname.toLowerCase();
      if (host.startsWith('www.')) host = host.substring(4);
      const path = parsed.pathname;

      if (host === 'youtube.com' || host === 'm.youtube.com') {
        return path === '/watch' || path.startsWith('/shorts/') || path.startsWith('/live/');
      }
      if (host === 'youtu.be') return path.length > 1;
      if (host === 'vimeo.com' || host === 'player.vimeo.com') return /\/\d+/.test(path);
      if (host === 'tiktok.com' || host === 'm.tiktok.com' || host === 'vm.tiktok.com') {
        return path.includes('/video/') || path.includes('/v/');
      }
      if (host === 'instagram.com' || host === 'm.instagram.com') {
        return /^\/(p|reel|tv|stories)\/([A-Za-z0-9_-]+)/.test(path);
      }
      if (host === 'twitter.com' || host === 'x.com' || host === 'mobile.twitter.com') {
        return path.includes('/status/');
      }
      if (host === 'facebook.com' || host === 'm.facebook.com' || host === 'fb.watch') {
        return path.includes('/watch') || path.includes('/reel/') || path.includes('/videos/') || path.includes('story.php');
      }
      if (host === 'reddit.com' || host === 'v.redd.it') {
        return path.includes('/comments/') || host === 'v.redd.it';
      }
      if (host === 'twitch.tv' || host === 'm.twitch.tv') {
        return path.includes('/videos/') || path.includes('/clip/');
      }
      if (host === 'bilibili.com' || host === 'b23.tv') {
        return path.includes('/video/');
      }
      if (host === 'dailymotion.com') return path.includes('/video/');
      return false;
    } catch (_) {
      return false;
    }
  }

  /**
   * Parse srcset string and return the highest resolution candidate URL.
   */
  function parseSrcsetBest(srcsetValue) {
    if (!srcsetValue || typeof srcsetValue !== 'string') return null;
    const candidates = srcsetValue.split(',').map((part) => {
      const trimmed = part.trim();
      const tokens = trimmed.split(/\s+/);
      const url = tokens[0];
      let score = 0;
      if (tokens.length > 1) {
        const desc = tokens[1].toLowerCase();
        if (desc.endsWith('w')) {
          score = parseInt(desc.slice(0, -1), 10) || 0;
        } else if (desc.endsWith('x')) {
          score = (parseFloat(desc.slice(0, -1)) || 1) * 1000;
        }
      }
      return { url, score };
    }).filter((c) => c.url && !c.url.startsWith('data:'));

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].url;
  }

  function cleanUrl(rawUrl) {
    try {
      const u = new URL(rawUrl, window.location.href);
      return u.href;
    } catch (_) {
      return null;
    }
  }

  function isKnownImageCdn(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return KNOWN_IMAGE_CDNS.some((cdn) => host.includes(cdn));
    } catch (_) {
      return false;
    }
  }

  function scanPageResources() {
    const discovered = new Map();

    function addResource(rawUrl, meta = {}) {
      if (!rawUrl || typeof rawUrl !== 'string') return;
      const absUrl = cleanUrl(rawUrl);
      if (!absUrl) return;
      if (!absUrl.startsWith('http://') && !absUrl.startsWith('https://')) return;

      // Deduplicate by URL without unstable tracking parameters
      const cleanPath = absUrl.split('?')[0].split('#')[0];
      const rawFilename = cleanPath.split('/').pop() || 'resource';
      const extMatch = rawFilename.match(/\.([a-z0-9]+)$/i);
      let ext = extMatch ? extMatch[1].toLowerCase() : (meta.extension || '');
      if (!ext && meta.type === 'image') {
        ext = 'jpg';
      }
      const isStream = meta.isStream || ext === 'm3u8' || ext === 'mpd' || meta.type === 'stream';

      const cleanTitle = (meta.title || decodeURIComponent(rawFilename)).replace(/[\r\n\t]+/g, ' ').trim();

      if (!discovered.has(absUrl)) {
        discovered.set(absUrl, {
          url: absUrl,
          filename: meta.filename || decodeURIComponent(rawFilename),
          extension: ext,
          type: meta.type || (isStream ? 'video' : 'file'),
          title: cleanTitle,
          thumbnail: meta.thumbnail || '',
          dimensions: meta.dimensions || '',
          isStream: Boolean(isStream)
        });
      } else {
        // If entry already exists, update if the new metadata is better
        const existing = discovered.get(absUrl);
        const isBetterTitle = cleanTitle && (
          !existing.title ||
          existing.title === 'YouTube Video' ||
          existing.title === 'resource' ||
          /^\d+:\d+(:?\d+)?$/.test(existing.title) ||
          (cleanTitle.length > existing.title.length && !/^\d+:\d+/.test(cleanTitle))
        );
        if (isBetterTitle) {
          existing.title = cleanTitle;
          if (meta.filename) existing.filename = meta.filename;
        }
        if (!existing.thumbnail && meta.thumbnail) {
          existing.thumbnail = meta.thumbnail;
        }
        if (meta.isStream) {
          existing.isStream = true;
          existing.type = 'video';
        }
      }
    }

    // 1. Direct page-level stream (ONLY if the current URL is an actual video post/clip, not a profile/feed/saved page)
    if (isDirectVideoUrl(window.location.href)) {
      const pageTitle = (
        document.querySelector('meta[property="og:title"]')?.content ||
        document.querySelector('meta[name="twitter:title"]')?.content ||
        document.title ||
        'Streaming Video'
      ).replace(/\s*-\s*(YouTube|Instagram|TikTok|Twitter|X)$/i, '').trim();

      const pageThumb = (
        document.querySelector('meta[property="og:image"]')?.content ||
        document.querySelector('meta[name="twitter:image"]')?.content ||
        document.querySelector('link[rel="image_src"]')?.href ||
        ''
      );

      addResource(window.location.href, {
        type: 'video',
        title: pageTitle,
        filename: `${pageTitle.slice(0, 80)}.mp4`,
        thumbnail: pageThumb,
        isStream: true
      });
    }

    // 2. Discover individual video posts, reels, and feeds (Instagram, YouTube, TikTok, Twitter/X)
    const host = window.location.hostname.toLowerCase();

    // 2a. Instagram Reels & Posts
    if (host.includes('instagram.com')) {
      document.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        const match = href.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
        if (!match) return;

        const postType = match[1];
        const shortcode = match[2];
        const postUrl = `https://www.instagram.com/${postType}/${shortcode}/`;

        // Check container or anchor for video indicators or thumbnail
        const container = a.closest('article') || a.closest('div[role="presentation"]') || a.parentElement || a;
        const hasVideoIcon = (
          postType === 'reel' ||
          postType === 'tv' ||
          container.querySelector('svg[aria-label*="Video" i], svg[aria-label*="Reel" i], svg[aria-label*="Clip" i], svg[aria-label*="Play" i], span[data-bloks-name*="video"]') !== null ||
          container.querySelector('video') !== null ||
          a.querySelector('svg') !== null
        );

        // Find best thumbnail inside container
        const img = container.querySelector('img') || a.querySelector('img');
        let thumbUrl = '';
        let altTitle = '';
        if (img) {
          thumbUrl = parseSrcsetBest(img.srcset) || img.currentSrc || img.src || '';
          altTitle = (img.alt || img.getAttribute('aria-label') || '').trim();
        }

        const title = altTitle || `Instagram ${postType === 'reel' ? 'Reel' : 'Post'} (${shortcode})`;

        if (hasVideoIcon) {
          addResource(postUrl, {
            type: 'video',
            title,
            filename: `${title.slice(0, 60)}.mp4`,
            thumbnail: thumbUrl,
            isStream: true
          });
        }

        // Always also add the image if available so it appears in the Images tab
        if (thumbUrl && thumbUrl.startsWith('http')) {
          addResource(thumbUrl, {
            type: 'image',
            title: title.slice(0, 100),
            thumbnail: thumbUrl,
            extension: 'jpg'
          });
        }
      });
    }

    // 2b. YouTube video cards, feeds, shorts, search results
    if (host.includes('youtube.com')) {
      // Check if current page is or belongs to a playlist
      try {
        const pageUrl = new URL(window.location.href);
        const listParam = pageUrl.searchParams.get('list');
        if (listParam && listParam !== 'WL' && listParam !== 'LL') {
          const playlistUrl = `https://www.youtube.com/playlist?list=${listParam}`;
          const plTitle = (
            document.querySelector('yt-dynamic-sizing-formatted-string#text')?.textContent ||
            document.querySelector('#header-description h3')?.textContent ||
            document.title ||
            'YouTube Playlist'
          ).replace(/\s*-\s*YouTube$/i, '').trim();

          addResource(playlistUrl, {
            type: 'playlist',
            title: `📁 Playlist: ${plTitle}`,
            filename: `${plTitle.slice(0, 60)} (Playlist)`,
            thumbnail: document.querySelector('meta[property="og:image"]')?.content || '',
            isStream: true,
            isPlaylist: true
          });
        }
      } catch (_) {}

      // Scan for playlist links (e.g. on channel playlists tab, search results, or sidebars)
      document.querySelectorAll('a[href*="/playlist?list="], a[href*="&list="]').forEach((plLink) => {
        const href = plLink.getAttribute('href') || '';
        const match = href.match(/[?&]list=([A-Za-z0-9_-]+)/);
        if (!match) return;
        const listId = match[1];
        if (listId === 'WL' || listId === 'LL') return;

        const plUrl = `https://www.youtube.com/playlist?list=${listId}`;
        let plTitle = (plLink.getAttribute('title') || plLink.textContent || '').trim();
        if (plTitle && !plTitle.toLowerCase().startsWith('http') && plTitle.length > 2) {
          addResource(plUrl, {
            type: 'playlist',
            title: `📁 Playlist: ${plTitle}`,
            filename: `${plTitle.slice(0, 60)} (Playlist)`,
            isStream: true,
            isPlaylist: true
          });
        }
      });

      // Priority 1: Scan structured video container cards (Homepage, Search, Subscriptions, Feeds)
      const YOUTUBE_CARD_SELECTORS = [
        'ytd-rich-item-renderer',
        'ytd-video-renderer',
        'ytd-compact-video-renderer',
        'ytd-grid-video-renderer',
        'ytd-reel-item-renderer',
        'yt-lockup-view-model',
        'ytd-rich-grid-media',
        'ytd-playlist-video-renderer'
      ].join(', ');

      document.querySelectorAll(YOUTUBE_CARD_SELECTORS).forEach((card) => {
        const link = card.querySelector('a#video-title-link, a#thumbnail, a[href*="/watch?v="], a[href*="/shorts/"]');
        if (!link) return;

        const href = link.getAttribute('href') || '';
        const vMatch = href.match(/[?&]v=([A-Za-z0-9_-]+)/);
        const sMatch = href.match(/\/shorts\/([A-Za-z0-9_-]+)/);
        const vidId = vMatch ? vMatch[1] : (sMatch ? sMatch[1] : null);
        if (!vidId) return;

        const vidUrl = sMatch ? `https://www.youtube.com/shorts/${vidId}` : `https://www.youtube.com/watch?v=${vidId}`;

        // Extract title
        let bestTitle = '';
        const titleEl = card.querySelector('#video-title, a#video-title-link, .yt-lockup-metadata-view-model__title, h3 a, h3');
        if (titleEl) {
          bestTitle = (titleEl.getAttribute('title') || titleEl.innerText || titleEl.textContent || '').trim();
        }

        if (!bestTitle) {
          const aria = link.getAttribute('aria-label') || '';
          if (aria) {
            const parts = aria.split(/\s+by\s+/);
            bestTitle = (parts[0] || '').trim();
          }
        }

        if (!bestTitle) {
          const img = card.querySelector('img[alt]');
          if (img && img.alt && img.alt.length > 3) {
            bestTitle = img.alt.trim();
          }
        }

        if (/^\d+:\d+(:?\d+)?$/.test(bestTitle) || bestTitle.toUpperCase() === 'SHORTS' || bestTitle.toLowerCase().startsWith('http')) {
          bestTitle = '';
        }

        const finalTitle = bestTitle || 'YouTube Video';
        const thumbUrl = `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`;

        addResource(vidUrl, {
          type: 'video',
          title: finalTitle.slice(0, 100),
          filename: `${finalTitle.slice(0, 60)}.mp4`,
          thumbnail: thumbUrl,
          isStream: true
        });
      });

      // Priority 2: Fallback scan for any loose video links
      document.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        const vMatch = href.match(/[?&]v=([A-Za-z0-9_-]+)/);
        const sMatch = href.match(/\/shorts\/([A-Za-z0-9_-]+)/);
        const vidId = vMatch ? vMatch[1] : (sMatch ? sMatch[1] : null);
        if (!vidId) return;

        const vidUrl = sMatch ? `https://www.youtube.com/shorts/${vidId}` : `https://www.youtube.com/watch?v=${vidId}`;
        let rawTitle = (a.getAttribute('title') || a.getAttribute('aria-label') || a.textContent || '').trim();

        if (rawTitle.includes(' by ')) {
          rawTitle = rawTitle.split(/\s+by\s+/)[0].trim();
        }

        if (rawTitle && !/^\d+:\d+(:?\d+)?$/.test(rawTitle) && rawTitle.toUpperCase() !== 'SHORTS' && !rawTitle.toLowerCase().startsWith('http')) {
          addResource(vidUrl, {
            type: 'video',
            title: rawTitle.slice(0, 100),
            filename: `${rawTitle.slice(0, 60)}.mp4`,
            thumbnail: `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`,
            isStream: true
          });
        }
      });
    }

    // 2c. TikTok video links
    if (host.includes('tiktok.com')) {
      document.querySelectorAll('a[href*="/video/"]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        if (href.includes('/video/')) {
          const abs = cleanUrl(href);
          if (abs) {
            const img = a.querySelector('img');
            const thumb = img ? (img.src || '') : '';
            const title = (a.textContent.trim() || 'TikTok Video').slice(0, 80);
            addResource(abs, {
              type: 'video',
              title,
              filename: `${title}.mp4`,
              thumbnail: thumb,
              isStream: true
            });
          }
        }
      });
    }

    // 3. Scan HTML5 <video> and <audio> elements
    document.querySelectorAll('video, audio').forEach((media) => {
      const tag = media.tagName.toLowerCase();
      const poster = tag === 'video' ? (media.poster || '') : '';
      const dims = tag === 'video' && media.videoWidth ? `${media.videoWidth}×${media.videoHeight}` : '';

      const handleSrc = (src) => {
        if (!src) return;
        if (src.startsWith('blob:')) {
          // If blob video, try to find an enclosing post anchor
          const parentAnchor = media.closest('a[href]') || media.closest('article')?.querySelector('a[href]');
          if (parentAnchor) {
            const aHref = parentAnchor.getAttribute('href');
            if (aHref && isDirectVideoUrl(aHref)) {
              addResource(aHref, {
                type: 'video',
                title: media.title || `${tag} media`,
                thumbnail: poster,
                isStream: true
              });
            }
          }
          return;
        }

        addResource(src, {
          type: tag,
          title: media.title || media.getAttribute('aria-label') || `${tag} media`,
          thumbnail: poster,
          dimensions: dims
        });
      };

      if (media.currentSrc) handleSrc(media.currentSrc);
      else if (media.src) handleSrc(media.src);

      media.querySelectorAll('source').forEach((source) => {
        if (source.src && !source.src.startsWith('blob:')) {
          addResource(source.src, {
            type: tag,
            title: source.type ? `${tag} (${source.type})` : `${tag} source`,
            thumbnail: poster,
            dimensions: dims
          });
        }
      });
    });

    // 4. Scan <img> elements (with srcset parsing, lazy-loading resolution, and CDN detection)
    document.querySelectorAll('img').forEach((img) => {
      // Pick best resolution candidate
      const bestSrc = (
        parseSrcsetBest(img.srcset) ||
        parseSrcsetBest(img.getAttribute('data-srcset')) ||
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('data-high-res-src') ||
        img.currentSrc ||
        img.src
      );

      if (!bestSrc || bestSrc.startsWith('blob:') || bestSrc.startsWith('data:image/svg')) return;
      if (bestSrc.startsWith('data:image/gif;base64,R0lGOD')) return; // common 1x1 spacer GIF

      // Compute display and natural dimensions
      const rect = img.getBoundingClientRect();
      const w = img.naturalWidth || img.width || Math.round(rect.width) || 0;
      const h = img.naturalHeight || img.height || Math.round(rect.height) || 0;

      // Extension & CDN check
      const cleanPath = bestSrc.split('?')[0].split('#')[0];
      const ext = cleanPath.split('.').pop().toLowerCase();
      const isKnownImgExt = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif', 'bmp'].includes(ext);
      const isCdn = isKnownImageCdn(bestSrc);

      // Filter: image must be visibly sized >= 60x60 or have known CDN/image extension
      if ((w >= 60 && h >= 60) || ((isKnownImgExt || isCdn) && (w >= 40 || w === 0))) {
        // Filter out noisy channel avatars and tiny icons on video platforms
        if (host.includes('youtube.com')) {
          if (bestSrc.includes('ggpht.com') || bestSrc.includes('/avatar') || bestSrc.includes('profile')) return;
          if (w < 100 && w !== 0) return;
        }

        const title = (
          img.alt ||
          img.title ||
          img.getAttribute('aria-label') ||
          cleanPath.split('/').pop() ||
          'Image'
        ).trim();

        addResource(bestSrc, {
          type: 'image',
          title: title.slice(0, 100),
          thumbnail: bestSrc,
          dimensions: w && h ? `${w}×${h}` : ''
        });
      }
    });

    // 5. Scan CSS background images on large elements (banners, cards, thumbnails)
    document.querySelectorAll('[style*="background-image"], [style*="background:"]').forEach((el) => {
      const style = el.getAttribute('style') || '';
      const match = style.match(/url\(['"]?(https?:\/\/[^'"\)\s]+)['"]?\)/i);
      if (match && match[1]) {
        const bgUrl = match[1];
        const rect = el.getBoundingClientRect();
        if (rect.width >= 60 && rect.height >= 60) {
          addResource(bgUrl, {
            type: 'image',
            title: el.getAttribute('aria-label') || 'Background Image',
            thumbnail: bgUrl,
            dimensions: `${Math.round(rect.width)}×${Math.round(rect.height)}`
          });
        }
      }
    });

    // 6. Scan downloadable file links <a>
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href) return;
      try {
        const clean = href.split('?')[0].split('#')[0];
        const extMatch = clean.match(/\.([a-z0-9]+)$/i);
        if (extMatch) {
          const ext = extMatch[1].toLowerCase();
          if (DOWNLOADABLE_EXTENSIONS[ext]) {
            const type = DOWNLOADABLE_EXTENSIONS[ext];
            addResource(href, {
              type: type,
              extension: ext,
              title: a.textContent.trim() || a.getAttribute('download') || clean.split('/').pop(),
              isStream: ext === 'm3u8' || ext === 'mpd'
            });
          }
        }
      } catch (_) {}
    });

    // Prioritize videos and streams first, followed by audio, files, and images
    const all = Array.from(discovered.values());
    all.sort((a, b) => {
      const aScore = (a.type === 'video' || a.isStream) ? 3 : (a.type === 'audio' ? 2 : (a.type !== 'image' ? 1 : 0));
      const bScore = (b.type === 'video' || b.isStream) ? 3 : (b.type === 'audio' ? 2 : (b.type !== 'image' ? 1 : 0));
      return bScore - aScore;
    });

    return all.slice(0, 200);
  }

  // Listen for requests from popup or background service worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'DETECT_PAGE_RESOURCES') {
      try {
        const resources = scanPageResources();
        sendResponse({ success: true, resources });
      } catch (err) {
        sendResponse({ success: false, error: err.message, resources: [] });
      }
    }
    return true;
  });
})();
