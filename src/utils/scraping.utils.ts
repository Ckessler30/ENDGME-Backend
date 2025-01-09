import { Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { CheerioAPI } from 'cheerio';
import { AnyNode } from 'domhandler';

export class ScrapingUtils {
  static getHeroPageUrl(heroName: string) {
    const formattedName = heroName.replace(/ /g, '_');
    const encodedName = encodeURIComponent(formattedName);
    return `https://marvelrivals.fandom.com/wiki/${encodedName}`;
  }

  static getHeroLoreSection(
    logger: Logger,
    heroName: string,
    heroUrl: string,
    heroPageData: string,
  ) {
    const $ = cheerio.load(heroPageData);

    const loreBlockquotes = $('blockquote').filter((i, el) => {
      const hasId = $(el).attr('id');
      const hasClass = $(el).attr('class');
      return !hasId && !hasClass;
    });

    if (loreBlockquotes.length === 0) {
      logger.warn(
        `No relevant blockquotes found for hero: ${heroName} at ${heroUrl}. Skipping...`,
      );
      return null;
    }

    let loreContent = '';
    let biographyFound = false;

    loreBlockquotes.each((i, blockquote) => {
      const pTags = $(blockquote).find('p');
      const lastP = pTags.last();
      const lastPText = lastP.text().trim();

      if (lastPText === '— Biography') {
        // Exclude the last p tag containing '— Biography'
        pTags.slice(0, -1).each((j, p) => {
          const paragraph = $(p).text().trim();
          if (paragraph) {
            loreContent += paragraph + '\n\n';
          }
        });
        biographyFound = true;
        return false; // Break out of the loop once the correct blockquote is found
      }
    });

    if (!biographyFound) {
      logger.warn(
        `No blockquote ending with '— Biography' found for hero: ${heroName} at ${heroUrl}. Skipping...`,
      );
      return null;
    }

    // Clean up the lore content
    loreContent = loreContent.trim();

    if (!loreContent) {
      logger.warn(
        `Empty lore content found for hero: ${heroName} at ${heroUrl}. Skipping...`,
      );
      return null;
    }

    return loreContent;
  }

  /**
   * Extracts the health value from the lore content.
   * @param $ - CheerioStatic instance
   * @returns The health value as a number, or null if not found.
   */
  static extractHealth(logger: Logger, heroPageData: string): number | null {
    const $ = cheerio.load(heroPageData);
    const healthDiv = $('div[data-source="health"]');
    if (healthDiv.length === 0) {
      logger.warn('Health div not found.');
      return null;
    }

    const healthText = healthDiv.find('div.pi-data-value').text().trim();
    const healthValue = parseInt(healthText, 10);

    if (isNaN(healthValue)) {
      logger.warn(`Invalid health value: "${healthText}"`);
      return null;
    }

    return healthValue;
  }

  /**
   * Extracts the difficulty value from the HTML.
   * @param $ - CheerioStatic instance
   * @returns The difficulty value as a number (1-5), or null if not found.
   */
  static extractDifficulty(
    logger: Logger,
    heroPageData: string,
  ): number | null {
    const $ = cheerio.load(heroPageData);
    const difficultyDiv = $('div[data-source="difficulty"]');
    if (difficultyDiv.length === 0) {
      logger.warn('Difficulty div not found.');
      return null;
    }

    const starImages = difficultyDiv.find('img');
    let difficulty = 0;

    starImages.each((i, img) => {
      const src = $(img).attr('alt') || '';
      if (src === 'StarFull') {
        difficulty += 1;
      }
    });

    if (difficulty < 1 || difficulty > 5) {
      logger.warn(`Unexpected difficulty value: ${difficulty}`);
      return null;
    }

    return difficulty;
  }

  static generateStats(logger: Logger, heroPageData: string) {
    const health = this.extractHealth(logger, heroPageData);
    const difficulty = this.extractDifficulty(logger, heroPageData);

    return {
      health,
      difficulty,
    };
  }

  /**
   * Extracts abilities from the given <aside> element.
   * @param aside - CheerioElement representing the <aside>
   * @param $ - CheerioStatic instance
   * @returns An array of ability objects.
   */
  static extractAbilitiesFromAside(
    aside: cheerio.BasicAcceptedElems<AnyNode>,
    $: cheerio.CheerioAPI,
    logger: Logger,
  ): Array<{
    name: string;
    type: string;
    description: string;
    stats: Record<string, any>;
  }> {
    const abilities: Array<{
      name: string;
      type: string;
      description: string;
      stats: Record<string, any>;
    }> = [];

    const abilityName = $(aside).find('h2[data-source="name"]').text().trim();
    const type = $(aside)
      .find('td[data-source="keybind"]')
      .text()
      .replace('<b>', '')
      .replace('</b>', '')
      .trim();
    const description = $(aside)
      .find('div[data-source="description"]')
      .text()
      .replace(/<i>|<\/i>/g, '')
      .trim();

    // Initialize stats object
    const stats: Record<string, any> = {};

    // Extract stat tables
    $(aside)
      .find('section.pi-item.pi-group.pi-border-color')
      .each((i, section) => {
        const table = $(section).find('table.pi-horizontal-group').first();
        if (table.length === 0) return;

        const headers = table
          .find(
            'th.pi-horizontal-group-item.pi-data-label.pi-secondary-font.pi-border-color.pi-item-spacing',
          )
          .map((i, th) =>
            $(th).text().trim().toLowerCase().replace(/\s+/g, '_'),
          )
          .get();

        const values = table
          .find(
            'td.pi-horizontal-group-item.pi-data-value.pi-font.pi-border-color.pi-item-spacing',
          )
          .map((i, td) => $(td).text().trim())
          .get();

        headers.forEach((header, index) => {
          if (header && values[index]) {
            // Convert headers to camelCase for consistency
            const camelCaseKey = header.replace(/_(.)/g, (_, chr) =>
              chr.toUpperCase(),
            );
            stats[camelCaseKey] = values[index];
          }
        });
      });

    // Extract additional properties if available
    const propertiesDiv = $(aside).find('div[data-source="properties"]');
    if (propertiesDiv.length > 0) {
      // Target only the inner div containing the properties description
      const innerPropertiesDiv = propertiesDiv
        .find('div.pi-data-value.pi-font')
        .first();
      if (innerPropertiesDiv.length > 0) {
        // Replace multiple spaces and newlines with single spaces for cleanliness
        const propertiesText =
          innerPropertiesDiv
            .html()
            ?.replace(/<\/?[^>]+(>|$)/g, '') // Remove any remaining HTML tags
            .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
            .trim() || '';

        stats['properties'] = propertiesText;
      } else {
        logger.warn(
          `Properties description div not found within properties for ability: ${abilityName}`,
        );
      }
    }

    abilities.push({
      name: abilityName,
      type,
      description,
      stats,
    });

    return abilities;
  }

  static extractAbilities(
    logger: Logger,
    heroPageData: string,
    heroId: string,
  ) {
    const $ = cheerio.load(heroPageData);
    const skillTable = $('table.wikitable.skill-table').first();

    if (skillTable.length > 0) {
      return this.extractNewFormatAbilities($, skillTable, heroId);
    } else {
      return this.extractLegacyAbilities($, heroId);
    }
  }

  private static capitalizeWords(text: string): string {
    return text
      .toLowerCase()
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private static extractNewFormatAbilities(
    $: CheerioAPI,
    skillTable: any,
    heroId: string,
  ) {
    const abilityRows = skillTable.find('tbody > tr');
    const abilitiesToInsert: Array<{
      hero_id: string;
      name: string;
      type: string;
      description: string;
      stats: Record<string, any>;
    }> = [];

    let currentAbility = null;

    abilityRows.each((i, tr) => {
      const tds = $(tr).find('td');

      // Check if this is a row containing type and name (has exactly 3 td elements)
      if (tds.length === 3) {
        // Get the type from the first td
        let type = '';
        const typeCell = tds.first();

        // Check for image with title (LMB/RMB case)
        const typeImg = typeCell.find('img');
        if (typeImg.length > 0) {
          let imgTitle = typeImg.attr('title');
          if (!imgTitle) {
            imgTitle = typeImg.attr('alt');
          }
          if (imgTitle === 'Left mouse button') {
            type = 'Left Mouse Button';
          } else if (imgTitle === 'Right mouse button') {
            type = 'Right Mouse Button';
          }
        } else {
          // If no image, get the text content
          type = typeCell.text().trim().toUpperCase();
        }

        // Get the name from the last td
        const name = this.capitalizeWords(tds.last().text().trim());

        // Initialize a new ability
        currentAbility = {
          name,
          type,
          description: '',
          stats: {},
        };

        abilitiesToInsert.push({
          hero_id: heroId,
          name: currentAbility.name,
          type: currentAbility.type,
          description: currentAbility.description,
          stats: currentAbility.stats,
        });
      }
      // Handle description and stats rows
      else if (
        currentAbility &&
        tds.length === 1 &&
        tds.attr('colspan') === '3'
      ) {
        const td = tds.first();
        const content = td.html();

        if (content) {
          // Extract description from <small><i> tags
          const description = td.find('small i').text().trim();
          if (description) {
            currentAbility.description = description;
            abilitiesToInsert[abilitiesToInsert.length - 1].description =
              description;
          }

          // Extract stats
          td.find('b').each((_, elem) => {
            const fullText = $(elem).text().trim();
            const separatorIndex = fullText.indexOf(' - ');

            if (separatorIndex !== -1) {
              const key = fullText
                .substring(0, separatorIndex)
                .toLowerCase()
                .replace(/ /g, '_')
                .replace(/_-$/, '');
              const value = fullText.substring(separatorIndex + 3).trim();
              if (key && value) {
                currentAbility.stats[key] = value;
              }
            } else {
              // Handle special effects or other stats without the ' - ' separator
              const nextText = elem.nextSibling
                ? $(elem.nextSibling).text().trim()
                : '';
              if (nextText) {
                const key = fullText
                  .replace(/:$/, '')
                  .toLowerCase()
                  .replace(/ /g, '_')
                  .replace(/_-$/, '');
                if (key) {
                  currentAbility.stats[key] = nextText;
                }
              }
            }
          });
        }
      }
    });

    return abilitiesToInsert;
  }

  private static extractLegacyAbilities($: CheerioAPI, heroId: string) {
    const abilities: Array<{
      hero_id: string;
      name: string;
      type: string;
      description: string;
      stats: Record<string, any>;
    }> = [];

    $('.fandom-table tbody tr td aside').each((_, aside) => {
      const ability = {
        hero_id: heroId,
        name: '',
        type: '',
        description: '',
        stats: {},
      };

      const name = this.capitalizeWords(
        $(aside).find('.pi-title').text().trim(),
      );
      ability.name = name;

      // Extract and map the type
      const rawType = $(aside).find('td[data-source="keybind"]').text().trim();

      // Map the type based on the raw value
      ability.type = this.mapAbilityType(rawType);

      const description = $(aside)
        .find('.pi-data[data-source="description"] .pi-data-value')
        .text()
        .trim();
      ability.description = description;

      // Extract all stats from horizontal groups
      $(aside)
        .find('.pi-horizontal-group')
        .each((_, group) => {
          const labels = $(group).find('.pi-data-label');
          const values = $(group).find('.pi-data-value');

          labels.each((i, label) => {
            const key = $(label).text().trim().toLowerCase().replace(/ /g, '_');
            const value = $(values.get(i)).text().trim();
            if (key && value) {
              ability.stats[key] = value;
            }
          });
        });

      // Extract properties if they exist
      const properties = $(aside)
        .find('.pi-data[data-source="properties"] .pi-data-value')
        .text()
        .trim();
      if (properties) {
        ability.stats['properties'] = properties;
      }

      abilities.push(ability);
    });

    return abilities;
  }

  private static mapAbilityType(rawType: string): string {
    const typeMap: Record<string, string> = {
      'Primary 1': 'Left Mouse Button',
      'Primary 2': 'Right Mouse Button',
      Primary: 'Left Mouse Button',
      Q: 'Q',
      E: 'E',
      F: 'F',
      Passive: 'Passive',
      'Left Shift': 'Left Shift',
    };

    return typeMap[rawType] || rawType;
  }
}
