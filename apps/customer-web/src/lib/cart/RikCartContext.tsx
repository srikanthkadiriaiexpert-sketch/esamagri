import { createCartContext } from './createCartContext';
import type { RikProduct } from '../api/types';

const rikCart = createCartContext<RikProduct>('Rik');

export const RikCartProvider = rikCart.Provider;
export const useRikCart = rikCart.useCart;
