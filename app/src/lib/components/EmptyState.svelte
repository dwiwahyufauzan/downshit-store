<script lang="ts">
	import Package from '@lucide/svelte/icons/package';

	let {
		title,
		description,
		actionHref,
		actionUrl,
		actionText,
		actionLabel
	}: {
		title: string;
		description?: string;
		actionHref?: string;
		actionUrl?: string;
		actionText?: string;
		actionLabel?: string;
	} = $props();

	const href = $derived(actionHref ?? actionUrl);
	const text = $derived(actionText ?? actionLabel);
</script>

<div class="border border-dashed border-line bg-mist/50 px-6 py-16 text-center">
	<Package size={32} class="mx-auto text-smoke" strokeWidth={1.5} />
	<h3 class="mt-4 text-sm font-bold tracking-[0.14em] uppercase">{title}</h3>
	{#if description}
		<p class="mx-auto mt-2 max-w-sm text-sm text-smoke">{description}</p>
	{/if}
	{#if href && text}
		<div class="mt-6">
			<a {href} class="btn btn-primary">{text}</a>
		</div>
	{/if}
</div>
