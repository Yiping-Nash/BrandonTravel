import pytest
from pydantic import ValidationError
from packages.contracts import ActivityInput, Command, TripCreate

def test_untimed_and_custom_activity():
    assert ActivityInput(title='自由活动',date='2026-11-01').startAt is None

@pytest.mark.parametrize('start,end', [('2026-11-01T10:00',None),('2026-11-01T11:00','2026-11-01T10:00'),('2026-11-01T23:00','2026-11-02T01:00'),('2026-11-01T10:00+08:00','2026-11-01T11:00+08:00')])
def test_invalid_times(start,end):
    with pytest.raises(ValidationError): ActivityInput(title='x',date='2026-11-01',startAt=start,endAt=end)

def test_command_discriminator_and_version():
    c=Command.model_validate({'expectedVersion':1,'command':{'type':'addActivity','activity':{'title':'x','date':'2026-11-01'}}})
    assert c.command.type=='addActivity'
    with pytest.raises(ValidationError): Command.model_validate({'expectedVersion':0,'command':{'type':'eraseEverything'}})

def test_trip_timezone_and_date_range():
    with pytest.raises(ValidationError): TripCreate(title='x',destination='x',startDate='2026-11-02',endDate='2026-11-01')
    with pytest.raises(ValidationError): TripCreate(title='x',destination='x',startDate='2026-11-01',endDate='2026-11-01',timezone='invalid')
