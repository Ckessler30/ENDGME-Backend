import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { Cron } from '@nestjs/schedule';
import robotsParser from 'robots-parser';
import { ScrapingUtils } from 'src/utils/scraping.utils';
import { CronExpression } from '@nestjs/schedule';

@Injectable()
export class ScrapingService {
  private readonly logger = new Logger(ScrapingService.name);

  private readonly newsUrls = [
    { url: 'https://marvelrivals.com/news/', type: 'announcement' },
    { url: 'https://marvelrivals.com/gameupdate/', type: 'update' },
    { url: 'https://marvelrivals.com/devdiaries/', type: 'dev_diary' },
  ];

  private readonly heroesUrl = 'https://marvelrivals.fandom.com/wiki/Heroes';

  private readonly marvelRivalsGameId = 'acbbf41e-1049-4adf-8b86-4033a324d404';

  constructor(private readonly supabaseService: SupabaseService) {}

  @Cron(CronExpression.EVERY_DAY_AT_8PM)
  async scrapeHeroAbilitiesCron() {
    await this.scrapeHeroAbilities();
  }

  @Cron(CronExpression.EVERY_DAY_AT_8PM)
  async scrapeHeroLoreAndStatsCron() {
    await this.scrapeHeroLoreAndStats();
  }

  @Cron(CronExpression.EVERY_DAY_AT_8PM)
  async scrapeNewsCron() {
    await this.scrapeNews();
  }

  private async canScrape(
    url: string,
    userAgent: string = '*',
  ): Promise<boolean> {
    try {
      const robotsUrl = new URL('/robots.txt', url).href;
      const { data } = await axios.get(robotsUrl);
      const robots = robotsParser(robotsUrl, data);
      return robots.isAllowed(url, userAgent);
    } catch (error) {
      this.logger.warn(
        `Could not fetch robots.txt: ${error.message}. Proceeding with caution.`,
      );
      return true;
    }
  }

  async scrapeNews(): Promise<void> {
    for (const news of this.newsUrls) {
      const { url, type } = news;
      try {
        this.logger.log(`Starting to scrape ${type} from ${url}`);

        const canScrape = await this.canScrape(url);
        if (!canScrape) {
          this.logger.warn(`Scraping is not allowed for ${url}. Skipping...`);
          continue;
        }

        const { data } = await axios.get(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
          },
        });
        this.logger.log(`Fetched data from ${url}`);
        const $ = cheerio.load(data);

        const newsItems = $('a.list-item');

        if (newsItems.length === 0) {
          this.logger.warn(`No news items found on ${url}.`);
          continue;
        }
        this.logger.log(`Found ${newsItems.length} news items on ${url}.`);

        for (const element of newsItems.toArray()) {
          const anchor = $(element);

          const link = anchor.attr('href')?.trim();
          if (!link) {
            this.logger.warn('No link found for a news item. Skipping...');
            continue;
          }

          const imageUrl =
            anchor.find('div.img img').attr('src')?.trim() || null;

          const title = anchor.find('div.text h2').text().trim();
          if (!title) {
            this.logger.warn(
              `No title found for news item with link ${link}. Skipping...`,
            );
            continue;
          }

          const description = anchor.find('div.text p').text().trim() || null;

          const publishedAt = new Date();
          const createdAt = new Date();
          const updatedAt = new Date();

          // Upsert the data to avoid duplicates
          const { data: upsertData, error } = await this.supabaseService
            .getClient()
            .from('news')
            .upsert(
              {
                title,
                content: description,
                published_at: publishedAt,
                created_at: createdAt,
                updated_at: updatedAt,
                game_id: this.marvelRivalsGameId,
                image_url: imageUrl,
                type: type, // Use dynamic type
                url: link,
              },
              { onConflict: 'url' },
            );

          if (error) {
            this.logger.error(`Error upserting ${type}: ${error.message}`);
            continue;
          }

          if (upsertData) {
            this.logger.log(`Upserted ${type}: ${JSON.stringify(upsertData)}`);
          }
        }

        this.logger.log(`Scraping ${type} from ${url} completed successfully.`);
      } catch (error) {
        this.logger.error(
          `Failed to scrape ${type} from ${url}: ${error.message}`,
        );
      }
    }
  }

  async scrapeHeroes(): Promise<void> {
    try {
      this.logger.log(`Starting to scrape heroes from ${this.heroesUrl}`);

      const canScrape = await this.canScrape(this.heroesUrl);
      if (!canScrape) {
        this.logger.warn(
          `Scraping is not allowed for ${this.heroesUrl}. Skipping...`,
        );
        return;
      }

      const { data } = await axios.get(this.heroesUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
        },
      });

      this.logger.log('Fetched data successfully.');

      this.logger.debug(`Fetched HTML snippet: ${data.substring(0, 1000)}`);

      const $ = cheerio.load(data);

      const heroes: {
        name: string;
        image_url: string;
        type: string;
        created_at: Date;
        game_id: string;
      }[] = [];

      const mrMainDivs = $('div#mr-main');
      this.logger.log(`Found ${mrMainDivs.length} div#mr-main elements.`);

      if (mrMainDivs.length === 0) {
        this.logger.warn('No div#mr-main elements found on the page.');
        return;
      }

      mrMainDivs.each((i, mrMainDiv) => {
        const section = $(mrMainDiv);

        const heroType = section
          .find('h3 .mw-headline')
          .first()
          .text()
          .trim()
          .toLowerCase();
        if (!heroType) {
          this.logger.warn(
            `No hero_type found in div#mr-main index ${i}. Skipping...`,
          );
          return;
        }

        this.logger.log(
          `Processing hero type: ${heroType} in div#mr-main index ${i}.`,
        );

        const galleryWrappers = section.find(
          'div.gallery-image-wrapper.accent',
        );
        this.logger.log(
          `Found ${galleryWrappers.length} heroes in hero type ${heroType}.`,
        );

        galleryWrappers.each((j, wrapper) => {
          const wrapperDiv = $(wrapper);

          const heroId = wrapperDiv.attr('id')?.trim();
          if (!heroId) {
            this.logger.warn(
              `No hero ID found for hero in hero type ${heroType}, index ${j}. Skipping...`,
            );
            return;
          }

          const img = wrapperDiv.find('img.thumbimage').first();
          const imageUrl = img.attr('data-src')?.trim();
          const titleAttr = img.attr('title')?.trim();

          if (!imageUrl) {
            this.logger.warn(
              `No image URL found for hero ID ${heroId}. Skipping...`,
            );
            return;
          }

          if (!titleAttr) {
            this.logger.warn(
              `No title attribute found for hero ID ${heroId}. Skipping...`,
            );
            return;
          }

          const nameMatch = titleAttr.match(/^(.+?)\s*\(/);
          const heroName = nameMatch ? nameMatch[1].trim() : titleAttr;

          if (!heroName) {
            this.logger.warn(
              `Could not parse hero name from title "${titleAttr}" for hero ID ${heroId}. Skipping...`,
            );
            return;
          }

          this.logger.debug(
            `Extracted hero: ID=${heroId}, Name=${heroName}, Image=${imageUrl}, Type=${heroType}`,
          );

          heroes.push({
            name: heroName,
            image_url: imageUrl,
            type: heroType,
            created_at: new Date(),
            game_id: this.marvelRivalsGameId,
          });
        });
      });

      this.logger.log(`Total heroes extracted: ${heroes.length}`);

      if (heroes.length === 0) {
        this.logger.warn('No heroes extracted to insert.');
        return;
      }

      const { error } = await this.supabaseService
        .getClient()
        .from('marvel_rivals_heroes')
        .upsert(heroes, { onConflict: 'name' });

      if (error) {
        this.logger.error(`Error upserting heroes: ${error.message}`);
        return;
      }

      this.logger.log('Heroes inserted successfully.');
    } catch (error) {
      this.logger.error(`Failed to scrape heroes: ${error.message}`);
    }
  }

  async scrapeHeroLoreAndStats(): Promise<void> {
    try {
      this.logger.log('Starting to scrape lore for all heroes.');

      // Fetch all heroes from the database
      const { data: heroes, error: fetchError } = await this.supabaseService
        .getClient()
        .from('marvel_rivals_heroes')
        .select('*');

      if (fetchError) {
        this.logger.error(`Error fetching heroes: ${fetchError.message}`);
        return;
      }

      if (!heroes || heroes.length === 0) {
        this.logger.warn('No heroes found in the database to scrape lore.');
        return;
      }

      this.logger.log(`Found ${heroes.length} heroes to scrape lore for.`);

      // Process each hero sequentially
      for (const hero of heroes) {
        const heroUrl = ScrapingUtils.getHeroPageUrl(hero.name);

        try {
          // Check robots.txt permissions
          const canScrape = await this.canScrape(heroUrl);
          if (!canScrape) {
            this.logger.warn(
              `Scraping is not allowed for ${heroUrl}. Skipping...`,
            );
            continue;
          }

          // Fetch the hero page with Axios
          const { data: heroPageData } = await axios.get(heroUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
            },
          });

          this.logger.log(`Fetched data for hero: \x1b[36m${hero.name}\x1b[0m`);

          const loreContent = ScrapingUtils.getHeroLoreSection(
            this.logger,
            hero.name,
            heroUrl,
            heroPageData,
          );

          if (!loreContent) {
            this.logger.warn(
              `No lore content found for hero: ${hero.name} at ${heroUrl}. Skipping...`,
            );
            continue;
          }

          this.logger.log(`Lore content for hero ${hero.name}`);

          const updatedStats = ScrapingUtils.generateStats(
            this.logger,
            heroPageData,
          );

          const { data: updateData, error: updateError } =
            await this.supabaseService
              .getClient()
              .from('marvel_rivals_heroes')
              .update({ lore: loreContent, stats: updatedStats })
              .eq('id', hero.id);

          if (updateError) {
            this.logger.error(
              `Error updating lore for hero ${hero.name}: ${updateError.message}`,
            );
            continue;
          }

          if (updateData) {
            this.logger.log(`Successfully updated lore for hero: ${hero.name}`);
          }
        } catch (heroError) {
          this.logger.error(
            `Failed to scrape lore for hero ${hero.name}: ${heroError.message}`,
          );
          continue;
        }
      }

      this.logger.log('Completed scraping lore for all heroes.');
    } catch (error) {
      this.logger.error(`Failed to scrape hero lore: ${error.message}`);
    }
  }

  async scrapeHeroAbilities(): Promise<void> {
    try {
      this.logger.log('Starting to scrape abilities for all heroes.');

      // Fetch all heroes from the database
      const { data: heroes, error: fetchError } = await this.supabaseService
        .getClient()
        .from('marvel_rivals_heroes')
        .select('id, name');

      if (fetchError) {
        this.logger.error(`Error fetching heroes: ${fetchError.message}`);
        return;
      }

      if (!heroes || heroes.length === 0) {
        this.logger.warn(
          'No heroes found in the database to scrape abilities.',
        );
        return;
      }

      this.logger.log(`Found ${heroes.length} heroes to scrape abilities for.`);

      // Process each hero sequentially
      for (const hero of heroes) {
        const heroUrl = ScrapingUtils.getHeroPageUrl(hero.name);

        this.logger.log(
          `Scraping abilities for hero: ${hero.name} from ${heroUrl}`,
        );

        try {
          // Check robots.txt permissions
          const canScrape = await this.canScrape(heroUrl);
          if (!canScrape) {
            this.logger.warn(
              `Scraping is not allowed for ${heroUrl}. Skipping...`,
            );
            continue;
          }

          // Fetch the hero page with Axios
          const { data: heroPageData } = await axios.get(heroUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
            },
          });

          this.logger.log(`Fetched data for hero: ${hero.name}`);

          // Load HTML into Cheerio
          const abilitiesToInsert = ScrapingUtils.extractAbilities(
            this.logger,
            heroPageData,
            hero.id,
          );

          if (abilitiesToInsert.length === 0) {
            this.logger.warn(
              `No abilities extracted for hero: ${hero.name} at ${heroUrl}.`,
            );
            continue;
          }

          const { data: insertData, error: insertError } =
            await this.supabaseService
              .getClient()
              .from('marvel_rivals_abilities')
              .upsert(abilitiesToInsert, { onConflict: 'name' });

          if (insertError) {
            this.logger.error(
              `Error inserting abilities for hero ${hero.name}: ${insertError.message}`,
            );
            continue;
          }

          if (insertData) {
            this.logger.log(
              `Successfully inserted ${insertData} abilities for hero: ${hero.name}`,
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (heroError) {
          this.logger.error(
            `Failed to scrape abilities for hero ${hero.name}: ${heroError.message}`,
          );
          continue;
        }
      }
      this.logger.log('Completed scraping abilities for all heroes.');
    } catch (error) {
      this.logger.error(`Failed to scrape hero abilities: ${error.message}`);
    }
  }
}
