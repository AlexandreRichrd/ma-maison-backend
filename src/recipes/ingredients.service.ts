import { Injectable } from '@nestjs/common';

@Injectable()
export class IngredientsService {
  /** Trim, lowercase, and collapse internal whitespace for ingredient/item matching. */
  normaliseIngredientName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
  }
}
