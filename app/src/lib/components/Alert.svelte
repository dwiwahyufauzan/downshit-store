<script lang="ts">
	let {
		type = 'info',
		message
	}: {
		type?: 'error' | 'success' | 'warning' | 'info';
		message: string;
	} = $props();

	const styles: Record<string, string> = {
		error: 'border-danger bg-danger-bg text-danger',
		success: 'border-ok bg-ok-bg text-ok',
		warning: 'border-warn bg-warn-bg text-warn',
		info: 'border-info bg-info-bg text-info'
	};
</script>

<div
	class="border-l-4 px-4 py-3 text-sm font-medium {styles[type]}"
	role={type === 'error' ? 'alert' : 'status'}
>
	{message}
</div>
