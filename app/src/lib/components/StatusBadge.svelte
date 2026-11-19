<script lang="ts">
	import { STATUS_BADGE, STATUS_LABEL, type OrderStatus } from '$lib/constants';

	let { status }: { status: string } = $props();

	const typed = $derived((status in STATUS_LABEL ? status : 'menunggu_pembayaran') as OrderStatus);
</script>

<span class="badge {STATUS_BADGE[typed]}">{STATUS_LABEL[typed] ?? status}</span>
