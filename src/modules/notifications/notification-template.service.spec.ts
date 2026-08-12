import { NotificationTemplateService } from './notification-template.service';

describe('NotificationTemplateService', () => {
  const templates = new NotificationTemplateService();

  it('renders a stable financial template in Arabic', () => {
    expect(
      templates.render('booking_earning_pending', 'ar', {
        title: 'Earning pending',
        body: 'English canonical body',
      }),
    ).toMatchObject({ locale: 'ar', fallback: false, title: 'الأرباح قيد التسوية' });
  });

  it('keeps canonical English for unknown templates', () => {
    expect(
      templates.render('future_template', 'ar', { title: 'Future', body: 'Canonical' }),
    ).toEqual({ title: 'Future', body: 'Canonical', locale: 'en', fallback: true });
  });

  it('renders stable backend notifications in Moroccan Darija', () => {
    expect(
      templates.render('booking_earning_pending', 'ary', {
        title: 'Earning pending',
        body: 'English canonical body',
      }),
    ).toMatchObject({ locale: 'ary', fallback: false, title: 'الربح باقي كيتصفى' });
  });
});
