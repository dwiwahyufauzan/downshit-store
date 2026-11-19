<script lang="ts">
	let {
		items,
		home = { label: 'Beranda', href: '/' }
	}: { items: { label: string; href?: string }[]; home?: { label: string; href: string } } =
		$props();
</script>

<nav aria-label="Breadcrumb" class="mb-6 text-[11px] tracking-[0.12em] text-smoke uppercase">
	<ol class="flex flex-wrap items-center gap-x-2 gap-y-1">
		<li><a href={home.href} class="hover:text-ink hover:underline">{home.label}</a></li>
		{#each items as item, i (i)}
			{@const last = i === items.length - 1}
			<li aria-hidden="true">/</li>
			<li
				class={last ? 'max-w-[14rem] truncate font-semibold text-ink' : ''}
				aria-current={last ? 'page' : undefined}
			>
				{#if item.href && !last}
					<a href={item.href} class="hover:text-ink hover:underline">{item.label}</a>
				{:else}
					{item.label}
				{/if}
			</li>
		{/each}
	</ol>
</nav>
