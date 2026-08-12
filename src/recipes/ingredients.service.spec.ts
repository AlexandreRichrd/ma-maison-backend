import { IngredientsService } from './ingredients.service';

describe('IngredientsService', () => {
  let service: IngredientsService;

  beforeEach(() => {
    service = new IngredientsService();
  });

  it('trims leading and trailing whitespace', () => {
    expect(service.normaliseIngredientName('  Milk  ')).toBe('milk');
  });

  it('lowercases the name', () => {
    expect(service.normaliseIngredientName('Ground Beef')).toBe('ground beef');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(service.normaliseIngredientName('Bell   pepper\t\tred')).toBe(
      'bell pepper red',
    );
  });

  it('treats differently-cased/spaced variants as equal', () => {
    expect(service.normaliseIngredientName('  Tomato Sauce ')).toBe(
      service.normaliseIngredientName('tomato    sauce'),
    );
  });
});
