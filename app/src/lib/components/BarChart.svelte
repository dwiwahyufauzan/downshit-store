<script lang="ts">
	type Point = { label: string; value: number; short?: string };
	let {
		data,
		title,
		format = (n: number) => String(n),
		height = 220
	}: {
		data: Point[];
		title: string;
		format?: (n: number) => string;
		height?: number;
	} = $props();

	const W = 640;
	const L = 52;
	const R = 8;
	const T = 24;
	const B = 28;
	const compact = new Intl.NumberFormat('id-ID', { notation: 'compact' });
	const niceMax = (v: number) => {
		const p = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
		return Math.ceil(v / p) * p || 1;
	};

	let active = $state<number | null>(null);

	const max = $derived(niceMax(Math.max(0, ...data.map((d) => d.value))));
	const plotH = $derived(height - T - B);
	const step = $derived((W - L - R) / Math.max(data.length, 1));
	const barW = $derived(Math.max(1, step * 0.7));
	const every = $derived(Math.max(1, Math.ceil(data.length / 10)));
	const ticks = $derived(
		[0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: T + plotH * (1 - f), v: max * f }))
	);
	const total = $derived(data.reduce((s, d) => s + d.value, 0));
	const summary = $derived(
		data.length === 0
			? `${title}: belum ada data`
			: `${title}: ${data.length} periode, dari ${data[0].label} sampai ${data[data.length - 1].label}, total ${format(total)}`
	);

	// Tooltip nilai untuk batang aktif (disesuaikan agar tidak keluar area grafik).
	const tip = $derived.by(() => {
		if (active === null || !data[active]) return null;
		const d = data[active];
		const cx = L + active * step + step / 2;
		const h = max > 0 ? (d.value / max) * plotH : 0;
		const anchor = cx < L + 70 ? 'start' : cx > W - R - 70 ? 'end' : 'middle';
		return {
			x: anchor === 'start' ? cx - barW / 2 : anchor === 'end' ? cx + barW / 2 : cx,
			y: Math.max(T - 8, T + plotH - h - 6),
			anchor,
			text: format(d.value)
		};
	});
</script>

<figure class="w-full text-smoke">
	<div class="overflow-x-auto">
		<svg viewBox="0 0 {W} {height}" role="img" aria-label={summary} class="w-full min-w-[30rem]">
			<title>{title}</title>
			{#each ticks as t (t.v)}
				<line
					x1={L}
					x2={W - R}
					y1={t.y}
					y2={t.y}
					stroke="currentColor"
					opacity={t.v === 0 ? 0.6 : 0.2}
					stroke-dasharray={t.v === 0 ? undefined : '2 3'}
				/>
				<text x={L - 6} y={t.y + 4} text-anchor="end" font-size="10" fill="currentColor">
					{compact.format(t.v)}
				</text>
			{/each}
			{#each data as d, i (d.label)}
				{@const h = max > 0 ? (d.value / max) * plotH : 0}
				<rect
					x={L + i * step + (step - barW) / 2}
					y={T + plotH - h}
					width={barW}
					height={h}
					class="fill-ink transition-opacity"
					opacity={active === null || active === i ? 1 : 0.3}
				>
					<title>{d.label}: {format(d.value)}</title>
				</rect>
				{#if i % every === 0 || active === i}
					<text
						x={L + i * step + step / 2}
						y={height - 8}
						text-anchor="middle"
						font-size="10"
						fill="currentColor"
						class={active === i ? 'font-bold' : ''}
					>
						{d.short ?? d.label}
					</text>
				{/if}
				<!-- Area sentuh/hover selebar kolom penuh agar batang pendek tetap mudah diarahkan -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<rect
					x={L + i * step}
					y={T}
					width={step}
					height={plotH}
					fill="transparent"
					onmouseenter={() => (active = i)}
					onmouseleave={() => (active = null)}
					ontouchstart={() => (active = i)}
				/>
			{/each}
			{#if tip}
				<text
					x={tip.x}
					y={tip.y}
					text-anchor={tip.anchor}
					font-size="11"
					font-weight="700"
					fill="var(--color-ink)"
					stroke="var(--color-paper)"
					stroke-width="3"
					paint-order="stroke"
					pointer-events="none"
				>
					{tip.text}
				</text>
			{/if}
		</svg>
	</div>

	<details class="mt-2 text-xs text-smoke print:hidden">
		<summary class="cursor-pointer font-semibold tracking-wide uppercase hover:text-ink">
			Lihat rincian data dalam tabel
		</summary>
		<div class="table-wrap mt-2 max-h-72 overflow-y-auto">
			<table class="data-table">
				<thead>
					<tr>
						<th>Periode</th>
						<th class="text-right">Nilai</th>
					</tr>
				</thead>
				<tbody>
					{#each data as d (d.label)}
						<tr>
							<td class="text-ink">{d.label}</td>
							<td class="text-right font-semibold text-ink tabular-nums">{format(d.value)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
</figure>
