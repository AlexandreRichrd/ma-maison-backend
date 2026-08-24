import { Injectable } from '@nestjs/common';
import type { Recipe, RecipeIngredient, RecipeStep } from '@prisma/client';

import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';

export type RecipePreview = Recipe & { ingredientCount: number };

export type RecipeDetail = {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
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
    return this.loadDetail(recipe);
  }

  private async loadDetail(recipe: Recipe): Promise<RecipeDetail> {
    const [ingredients, steps] = await Promise.all([
      this.prisma.recipeIngredient.findMany({
        where: { recipeId: recipe.id },
        orderBy: { position: 'asc' },
      }),
      this.prisma.recipeStep.findMany({
        where: { recipeId: recipe.id },
        orderBy: { position: 'asc' },
      }),
    ]);
    return { recipe, ingredients, steps };
  }

  async create(dto: CreateRecipeDto): Promise<RecipeDetail> {
    const recipe = await this.prisma.$transaction(async (tx) => {
      const recipe = await tx.recipe.create({
        data: { name: dto.name, servings: dto.servings },
      });
      await tx.recipeIngredient.createMany({
        data: dto.ingredients.map((ingredient, index) => ({
          recipeId: recipe.id,
          name: ingredient.name,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          position: index,
        })),
      });
      await tx.recipeStep.createMany({
        data: dto.steps.map((step, index) => ({
          recipeId: recipe.id,
          text: step.text,
          position: index,
        })),
      });
      return recipe;
    });
    return this.loadDetail(recipe);
  }

  /** ingredients/steps, when present, replace the recipe's full current set — not a per-row patch. */
  async update(id: string, dto: UpdateRecipeDto): Promise<RecipeDetail> {
    const existing = await this.prisma.recipe.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(404, 'id', 'not_found');
    }

    const recipe = await this.prisma.$transaction(async (tx) => {
      const recipe = await tx.recipe.update({
        where: { id },
        data: {
          name: dto.name,
          servings: dto.servings,
          updatedAt: new Date(),
        },
      });

      if (dto.ingredients) {
        await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
        await tx.recipeIngredient.createMany({
          data: dto.ingredients.map((ingredient, index) => ({
            recipeId: id,
            name: ingredient.name,
            quantity: ingredient.quantity,
            unit: ingredient.unit,
            position: index,
          })),
        });
      }

      if (dto.steps) {
        await tx.recipeStep.deleteMany({ where: { recipeId: id } });
        await tx.recipeStep.createMany({
          data: dto.steps.map((step, index) => ({
            recipeId: id,
            text: step.text,
            position: index,
          })),
        });
      }

      return recipe;
    });
    return this.loadDetail(recipe);
  }

  /** Cascades recipe_ingredients/recipe_steps; shopping_items.sourceRecipeId is SetNull (see schema.prisma). */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.recipe.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(404, 'id', 'not_found');
    }
    await this.prisma.recipe.delete({ where: { id } });
  }
}
