import { Injectable } from '@nestjs/common';
import type { Recipe, RecipeIngredient } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export type RecipePreview = Recipe & { ingredientCount: number };

export type RecipeDetail = {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
};

@Injectable()
export class RecipesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<RecipePreview[]> {
    // Ingredient count is an aggregate query, not a stored counter column
    // (see my-home-backend/CLAUDE.md's Database section).
    const recipes = await this.prisma.recipe.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { ingredients: true } } },
    });
    return recipes.map(({ _count, ...recipe }) => ({
      ...recipe,
      ingredientCount: _count.ingredients,
    }));
  }

  async detail(id: string): Promise<RecipeDetail | null> {
    const recipe = await this.prisma.recipe.findUnique({ where: { id } });
    if (!recipe) return null;

    const ingredients = await this.prisma.recipeIngredient.findMany({
      where: { recipeId: id },
      orderBy: { position: 'asc' },
    });

    return { recipe, ingredients };
  }
}
