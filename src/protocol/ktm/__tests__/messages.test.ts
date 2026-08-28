import {
  buildMessage,
  formatDistance,
  guidanceView,
  notificationView,
  restoreView,
  serializeMessage,
} from '../messages';

describe('dashboard messages', () => {
  it('marks empty fields as hidden and filled ones as visible', () => {
    const message = buildMessage(notificationView('Fuel in 20 km'), 7);
    expect(message.UpdateUI.NotificationText).toEqual({
      Text: 'Fuel in 20 km',
      Visibility: 'full',
    });
    expect(message.UpdateUI.TurnRoad).toEqual({Text: '', Visibility: 'off'});
    expect(message.UpdateUI.TurnIcon).toEqual({Image: 'UNDEFINED', Visibility: 'off'});
  });

  it('uses the guidance message id only in the guidance context', () => {
    expect(buildMessage(restoreView(), 0).MsgId).toBe('Restore#0');
    expect(buildMessage(guidanceView({icon: 'GO_STRAIGHT'}), 3).MsgId).toBe('gon#3');
  });

  it('serialises to the field names the dashboard expects', () => {
    const json = JSON.parse(serializeMessage(guidanceView({icon: 'KEEP_LEFT'}), 1));
    expect(Object.keys(json)).toEqual(['UiContext', 'UpdateUI', 'MsgId']);
    expect(Object.keys(json.UpdateUI)).toEqual([
      'TurnRoad',
      'TurnDist',
      'TurnDistUnit',
      'TurnIcon',
      'GpsIcon',
      'Dist2Target',
      'ETA',
      'TurnInfo',
      'NotificationText',
      'NotificationIcon',
    ]);
  });
});

describe('formatDistance', () => {
  it.each([
    [12, '10', 'm'],
    [96, '100', 'm'],
    [349, '350', 'm'],
    [1200, '1.2', 'km'],
    [42_400, '42', 'km'],
  ])('formats %i m as %s %s', (metres, value, unit) => {
    expect(formatDistance(metres)).toEqual({value, unit});
  });

  it('never shows a negative distance', () => {
    expect(formatDistance(-50)).toEqual({value: '0', unit: 'm'});
  });
});

describe('guidanceView', () => {
  it('splits the turn distance into a value and a unit', () => {
    const view = guidanceView({icon: 'QUITE_RIGHT', distanceM: 1500, remainingM: 8000});
    expect(view.turnDist).toBe('1.5');
    expect(view.turnDistUnit).toBe('km');
    expect(view.dist2Target).toBe('8.0 km');
  });

  it('leaves fields undefined when there is nothing to show', () => {
    const view = guidanceView({icon: 'END'});
    expect(view.turnDist).toBeUndefined();
    expect(view.eta).toBeUndefined();
  });
});
