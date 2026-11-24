import { createCartContext } from './createCartContext';
import type { PifProduct } from '../api/types';

const pifCart = createCartContext<PifProduct>('Pif');

export const PifCartProvider = pifCart.Provider;
export const usePifCart = pifCart.useCart;
