<!-- @component A component -->

<script module>
	export const a = 1;
</script>

<style>
	p { color: red; }
</style>

<script lang="ts">
	let b: number = a;
</script>

<svelte:options runes />
<!-- not before a section -->
<p>{b}</p>
