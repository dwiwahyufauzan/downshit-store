import { redirect } from '@sveltejs/kit';
import { homeFor } from '#lib/server/auth';
import { performLogin } from '#lib/server/login';
import { mailEnabled } from '#lib/server/mail';
import type { Actions, PageServerLoad } from './$types';

// Portal PELANGGAN (role konsumen). Staf masuk lewat /staff/login.
export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) {
		redirect(303, homeFor(locals.user.role));
	}
	return {
		// lupa password lewat email hanya ditawarkan bila email terkonfigurasi
		mailEnabled: mailEnabled(),
		justReset: url.searchParams.get('reset') === '1'
	};
};

export const actions: Actions = {
	default: (event) => performLogin(event, 'customer')
};
