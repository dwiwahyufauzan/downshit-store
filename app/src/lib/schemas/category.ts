import { z } from 'zod';
import { optionalText, textField } from './common';

export const categorySchema = z.object({
	name: textField('Nama kategori', 2, 100),
	description: optionalText('Deskripsi', 500)
});
