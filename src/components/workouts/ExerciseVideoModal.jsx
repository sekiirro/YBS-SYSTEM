import React from 'react';
import { Modal, Button } from '@/components/ui';
import { ExternalLink, Video } from 'lucide-react';

function getEmbedUrl(url) {
  if (!url) return null;

  // YouTube
  const ytMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  if (ytMatch && ytMatch[1]) {
    return `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?autoplay=1&rel=0`;
  }

  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/(?:[^\/]*)\/videos\/|album\/(?:\d+)\/video\/|video\/|)(\d+)/);
  if (vimeoMatch && vimeoMatch[1]) {
    return `https://player.vimeo.com/video/${vimeoMatch[1]}?autoplay=1`;
  }

  // Direct video file
  if (url.match(/\.(mp4|webm|ogg)($|\?)/i)) {
    return url;
  }

  return null;
}

export default function ExerciseVideoModal({ open, onClose, exerciseName, videoUrl, instructions }) {
  if (!open) return null;

  const embedUrl = getEmbedUrl(videoUrl);
  const isDirectVideo = embedUrl && embedUrl.match(/\.(mp4|webm|ogg)($|\?)/i);

  return (
    <Modal open={open} onClose={onClose} title={exerciseName || 'Exercise Demonstration'} size="lg">
      <div className="space-y-4">
        {embedUrl ? (
          <div className="aspect-video w-full rounded-xl overflow-hidden bg-black/80 border border-border shadow-md">
            {isDirectVideo ? (
              <video
                src={embedUrl}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            ) : (
              <iframe
                src={embedUrl}
                title={exerciseName}
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            )}
          </div>
        ) : videoUrl ? (
          <div className="p-6 text-center space-y-3 rounded-xl bg-secondary/30 border border-border">
            <Video className="w-10 h-10 mx-auto text-primary" />
            <div>
              <h4 className="text-sm font-semibold text-foreground">External Video Link</h4>
              <p className="text-xs text-muted-foreground mt-1">
                This exercise video cannot be embedded directly in the app.
              </p>
            </div>
            <a
              href={videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              <span>Open Demonstration Video</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        ) : (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No demonstration video linked for this exercise yet.
          </div>
        )}

        {instructions && (
          <div className="p-3.5 rounded-xl bg-secondary/40 border border-border space-y-1">
            <h4 className="text-xs font-semibold text-foreground">Technique & Instructions:</h4>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {instructions}
            </p>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose} className="text-xs">
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
