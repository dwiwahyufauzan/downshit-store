import Hls from 'hls.js';

/**
 * Svelte Action untuk memutar video HLS (.m3u8) maupun format native (.mp4/.webm)
 * secara responsif, looping, muted, dan autoplay di semua browser modern & mobile.
 */
export function hlsVideo(node: HTMLVideoElement, src: string) {
	if (!src) return;
	node.muted = true;
	node.playsInline = true;
	node.controls = false;
	node.disablePictureInPicture = true;
	let hls: Hls | null = null;

	const play = () => {
		const p = node.play();
		if (p !== undefined) {
			p.catch(() => {});
		}
	};

	// Latar belakang tanpa kontrol: kalau browser menahan autoplay (mode hemat daya, tab baru
	// dibuka, dll.) putar lagi begitu siap, tab kembali terlihat, atau pada sentuhan pertama.
	const resume = () => {
		if (node.paused && !node.ended) play();
	};
	const onVisible = () => {
		if (!document.hidden) resume();
	};
	node.addEventListener('canplay', resume);
	node.addEventListener('pause', resume);
	document.addEventListener('visibilitychange', onVisible);
	window.addEventListener('pointerdown', resume, { once: true, passive: true });
	window.addEventListener('scroll', resume, { once: true, passive: true });

	if (node.canPlayType('application/vnd.apple.mpegurl')) {
		// Safari macOS & iOS native HLS
		node.src = src;
		play();
	} else if (Hls.isSupported() && src.includes('.m3u8')) {
		// Chrome, Firefox, Edge, Android HLS
		hls = new Hls({
			enableWorker: true,
			lowLatencyMode: true
		});
		hls.loadSource(src);
		hls.attachMedia(node);
		hls.on(Hls.Events.MANIFEST_PARSED, () => {
			play();
		});
	} else {
		node.src = src;
		play();
	}

	return {
		update(newSrc: string) {
			if (newSrc === src) return;
			src = newSrc;
			if (hls) {
				hls.destroy();
				hls = null;
			}
			if (node.canPlayType('application/vnd.apple.mpegurl')) {
				node.src = src;
				play();
			} else if (Hls.isSupported() && src.includes('.m3u8')) {
				hls = new Hls({
					enableWorker: true,
					lowLatencyMode: true
				});
				hls.loadSource(src);
				hls.attachMedia(node);
				hls.on(Hls.Events.MANIFEST_PARSED, () => {
					play();
				});
			} else {
				node.src = src;
				play();
			}
		},
		destroy() {
			node.removeEventListener('canplay', resume);
			node.removeEventListener('pause', resume);
			document.removeEventListener('visibilitychange', onVisible);
			window.removeEventListener('pointerdown', resume);
			window.removeEventListener('scroll', resume);
			if (hls) {
				hls.destroy();
				hls = null;
			}
		}
	};
}
