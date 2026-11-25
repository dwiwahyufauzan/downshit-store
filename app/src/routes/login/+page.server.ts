import { redirect } from '@sveltejs/kit';
import { homeFor } from '#lib/server/auth';
import { performLogin } from '#lib/server/login';
import type { Actions, PageServerLoad } from './$types';

// Portal PELANGGAN (role konsumen). Staf masuk lewat /staff/login.
export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) {
		redirect(303, homeFor(locals.user.role));
	}
};

export const actions: Actions = {
	default: (event) => performLogin(event, 'customer')
};
