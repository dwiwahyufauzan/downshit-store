<script lang="ts">
	import StaffProfile from '#lib/components/StaffProfile.svelte';
	// data & form berasal dari load/actions milik /profil (di-re-export)
	import type { PageProps } from '../../profil/$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Profil Akun - Owner Downshit</title>
</svelte:head>

<StaffProfile {data} {form} />
