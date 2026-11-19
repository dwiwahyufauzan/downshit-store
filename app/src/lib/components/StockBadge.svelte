<script lang="ts">
	let { stock, lowStockThreshold = 5 }: { stock: number; lowStockThreshold?: number } = $props();
</script>

{#if stock <= 0}
	<span class="badge badge-danger">Habis</span>
{:else if stock <= lowStockThreshold}
	<span class="badge badge-warn">Tersisa {stock}</span>
{:else}
	<span class="badge badge-muted">Stok {stock}</span>
{/if}
